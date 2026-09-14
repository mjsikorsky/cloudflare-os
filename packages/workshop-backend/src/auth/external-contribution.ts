import type {ContributionAuthor} from "@gadgets/workshop-shared/api";

/** Exact native resource delegated by a trusted host. The host derives the author from
 * its verified execution, never from a client's RPC arguments or a saved locator's person.
 */
export interface ExternalContributionTarget {
  readonly workspaceId: string;
  readonly chatId: number;
  readonly author: Readonly<ContributionAuthor>;
}

/** Snapshot the destination before native account/workspace admission awaits anything.
 * Native openGadget/createContribution still own sharing, observer, chat and author validation.
 */
export function validateExternalContribution(target: ExternalContributionTarget): Readonly<ExternalContributionTarget> {
  const snapshot = Object.freeze({workspaceId: target?.workspaceId, chatId: target?.chatId,
    author: Object.freeze({id: target?.author?.id, name: target?.author?.name})});
  if (typeof snapshot.workspaceId !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.workspaceId)
      || !Number.isSafeInteger(snapshot.chatId) || snapshot.chatId < 0
      || typeof snapshot.author.id !== "string" || typeof snapshot.author.name !== "string") {
    throw new Error("Invalid external contribution target.");
  }
  return snapshot;
}
