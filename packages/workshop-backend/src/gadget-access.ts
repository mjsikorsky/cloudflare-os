import type { GadgetAccessConfiguration } from '@gadgets/workshop-shared/api';

/** Hash a client-generated 256-bit capability; raw keys never enter gadget records or code. */
export async function gadgetAccessHash(access?: GadgetAccessConfiguration): Promise<string | undefined> {
  if (!access || access.visibility === 'workspace') return undefined;
  if (!/^[A-Za-z0-9_-]{43}$/.test(access.key)) throw new Error('A gadget access key must be a random 256-bit base64url capability.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(access.key))), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Admission is captured as a digest, then compared again whenever a retained client is used. */
export function assertGadgetAccess(currentHash: string | undefined, admittedHash: string | undefined): void {
  if (currentHash && currentHash !== admittedHash) throw new Error('This gadget requires its current access key.');
}

/** Re-check an admitted export before and after every read; bytes already delivered cannot be recalled. */
export function guardGadgetExport(stream: ReadableStream<Uint8Array>, authorize: () => void): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        authorize();
        const chunk = await reader.read();
        authorize();
        if (chunk.done) controller.close(); else controller.enqueue(chunk.value);
      } catch (error) {
        await reader.cancel(error).catch(() => {});
        controller.error(error);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  }, { highWaterMark: 0 });
}
