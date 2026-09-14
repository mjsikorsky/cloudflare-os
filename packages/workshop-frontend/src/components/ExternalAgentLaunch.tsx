import { useServerConfig } from '../ServerConfigContext';

/** Native selection supplies intent only; the host must authorize the actual launch. */
export default function ExternalAgentLaunch({workspaceId, chatId}: {
  workspaceId: string;
  chatId: number | null;
}) {
  const action = useServerConfig()?.externalAgentLaunch;
  if (!action || chatId === null) return null;
  // noreferrer would turn a form POST Origin into null and defeat the host CSRF check.
  return <form method="post" action={action.actionUrl} target="_blank" rel="noopener">
    <input type="hidden" name="cfosWorkspaceId" value={workspaceId} />
    <input type="hidden" name="cfosChatId" value={chatId} />
    <button type="submit" className="rounded px-2 py-1 text-sm text-kumo-default hover:bg-kumo-tint">
      {action.label}
    </button>
  </form>;
}
