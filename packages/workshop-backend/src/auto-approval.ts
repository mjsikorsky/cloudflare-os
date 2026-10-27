// Auto-approval drain core: applies the gatekeeper's eligible pending actions (read off the sparse
// pendingByGatekeeper index) in id order, with a per-gatekeeper single-flight guard so two
// concurrent drains (the DO's input gate is open across the apply await) can't double-apply the
// same action. The apply is injected, keeping this constructible over a mock storage in tests.

import type { Collection, NonUniqueIndex, Singleton } from "@gadgets/typed-storage";
import type { AiChatAuthorInfo } from "@gadgets/workshop-shared/api";
import type { ActionAudience, ActionDescription } from "@gadgets/workshop-shared/gatekeeper";
import { createWorkshopLogger } from "./observability";
import type { ActionRecord, AutoApproveTagRecord } from "./overseer.js";

const logger = createWorkshopLogger("workshop.auto.approval");

export interface AutoApprovalStorage {
  actions: Collection<ActionRecord, number>
      & { pendingByGatekeeper: NonUniqueIndex<ActionRecord, number> };
  autoApproveTags: Collection<AutoApproveTagRecord>;

  /**
   * The restricted-data latch (see makeOverseerStorage). While set, an action auto-approves only
   * when it declares an audience every restricted producer admits.
   */
  containsRestrictedData: Singleton<boolean>;

  /**
   * The gatekeepers whose observations set the latch, or null when unknown (a workspace latched
   * before producers were recorded). Unknown producers admit nothing.
   */
  restrictedProducers: Singleton<number[] | null>;
}

/** Asks one restricted producer whether everyone in an audience can already see its data. */
export type AudienceCheck = (producerGatekeeperId: number, audience: ActionAudience) => Promise<boolean>;

/**
 * The synchronous half of the decision: the enabling rule if the author marked the action
 * `autoApprovable` and the user enabled a rule for its `actionKind` on this gatekeeper. In a
 * restricted workspace the action must also declare an audience; whether its producers admit it
 * is the asynchronous half, `autoApprovalDecision()`.
 */
export function autoApprovalRule(
    storage: AutoApprovalStorage, gatekeeperId: number, description: ActionDescription)
    : AutoApproveTagRecord | undefined {
  if (description.autoApprovable !== true) return undefined;
  let tag = description.actionKind?.tag;
  if (tag === undefined) return undefined;
  if (storage.containsRestrictedData.get() && description.audience === undefined) return undefined;
  return storage.autoApproveTags.get(`${gatekeeperId}:${tag}`);
}

/**
 * In a restricted workspace, the producers that admitted the action's audience (every one must, and
 * a refusal, a throw or unknown producers mean no); outside one, nobody needs asking. Undefined when
 * not admitted.
 */
export async function restrictedAudienceAdmission(
    storage: AutoApprovalStorage, description: ActionDescription, admits: AudienceCheck)
    : Promise<number[] | undefined> {
  if (!storage.containsRestrictedData.get()) return [];
  let audience = description.audience;
  let producers = storage.restrictedProducers.get();
  if (audience === undefined || !producers || producers.length === 0) return undefined;
  let answers = await Promise.all(producers.map(id => admits(id, audience).catch(() => false)));
  return answers.every(answer => answer === true) ? [...producers] : undefined;
}

/**
 * The single authority on whether an action may be applied without a human: the enabling rule and,
 * in a restricted workspace, the producers that admitted its audience. Undefined means a person
 * decides.
 */
export async function autoApprovalDecision(
    storage: AutoApprovalStorage, gatekeeperId: number, description: ActionDescription,
    admits: AudienceCheck)
    : Promise<{ rule: AutoApproveTagRecord; admittedBy: number[] } | undefined> {
  let rule = autoApprovalRule(storage, gatekeeperId, description);
  if (rule === undefined) return undefined;
  let admittedBy = await restrictedAudienceAdmission(storage, description, admits);
  return admittedBy === undefined ? undefined : { rule, admittedBy };
}

/**
 * Applies a single eligible pending action: invoke the gatekeeper, mark it approved, persist. The
 * caller has already validated that the record is still pending.
 */
export type ApplyPendingActionFn = (
    record: ActionRecord & {type: "action"},
    resolvedBy: AiChatAuthorInfo,
    autoApproved: boolean,
    audienceAdmittedBy?: number[]) => Promise<void>;

export class AutoApprovalDrainer {
  // Per-gatekeeper single-flight state. Key present => a drain is running for that gatekeeper; the
  // value is a "rerun" flag, set when another drain is requested while one is in flight, so work
  // submitted during a drain isn't lost.
  #draining = new Map<number, boolean>();

  constructor(
      private storage: AutoApprovalStorage,
      private applyPendingAction: ApplyPendingActionFn,
      private admits: AudienceCheck = async () => false) {}

  async drain(gatekeeperId: number): Promise<void> {
    if (this.#draining.has(gatekeeperId)) {
      this.#draining.set(gatekeeperId, true);  // ask the running drain to loop again
      return;
    }
    this.#draining.set(gatekeeperId, false);
    try {
      do {
        this.#draining.set(gatekeeperId, false);
        await this.#drainOnce(gatekeeperId);
      } while (this.#draining.get(gatekeeperId));
    } finally {
      this.#draining.delete(gatekeeperId);
    }
  }

  // Apply all currently-eligible pending actions of the gatekeeper, in ascending id order. Stops
  // at the first pending action that is NOT auto-eligible (a manual gate) or that throws while
  // applying -- it is never skipped ahead of. This preserves in-order application and the
  // invariant that nothing is silently applied past a human gate.
  //
  // Eligibility is `autoApprovalDecision()`: the author's `autoApprovable` verdict, a user-enabled
  // rule for the action's kind, and, in a restricted workspace, an audience every producer admits.
  async #drainOnce(gatekeeperId: number): Promise<void> {
    // Materialize before applying: the index yields lazily in ascending id order, and applying
    // mutates it mid-iteration. Actions created after this snapshot trigger their own drain(),
    // which drain()'s rerun flag folds into this run if it's still in flight.
    let pending = [...this.storage.actions.pendingByGatekeeper.get(gatekeeperId)];

    for (let record of pending) {
      if (record.type !== "action") continue;

      let rule = autoApprovalRule(this.storage, gatekeeperId, record.description);
      // Producers are asked only in a restricted workspace; elsewhere the drain stays free of
      // awaits before the apply, as it always was.
      let admittedBy = rule !== undefined && this.storage.containsRestrictedData.get()
          ? await restrictedAudienceAdmission(this.storage, record.description, this.admits)
          : [];
      if (rule === undefined || admittedBy === undefined) {
        // A manual gate. Stop rather than skipping ahead to any later auto-eligible action.
        return;
      }

      // Re-check immediately before applying, to guard against a concurrent drain having already
      // taken this one.
      let fresh = this.storage.actions.get(record.id);
      if (!fresh || fresh.type !== "action" || fresh.state !== "pending") {
        continue;
      }

      try {
        // Attribute the auto-approval to the user who enabled the rule -- it runs under their
        // authority.
        await this.applyPendingAction(fresh, rule.enabledBy, true,
            admittedBy.length > 0 ? admittedBy : undefined);
      } catch (err) {
        // Leave the action pending for manual handling and stop the drain (never skip ahead).
        logger.error("auto-approval failed", {
          event: "auto.approval.failed", actionId: fresh.id, error: err,
        });
        return;
      }
    }
  }
}
