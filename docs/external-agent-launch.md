# Opening an external agent from a native conversation

`EXTERNAL_AGENT_LAUNCH` is deployment-owned JSON with a `label` and canonical
same-origin `actionUrl`, for example:

```json
{"label":"Open with your Dragon","actionUrl":"/legion/api/dsh/contribute"}
```

The public server configuration delivers this action to the native editor. Its
toolbar submits a form POST containing the current `cfosWorkspaceId` and
`cfosChatId`, including chat zero, in a new tab with no opener. Changing the
native selected conversation changes the submitted selection. No action is
shown while there is no selected conversation. The form retains `noopener` but
not `noreferrer`: the receiving host must be able to verify the browser's
`Origin` on the POST. Hosting policies must likewise retain the origin for this
form submission (for example, `strict-origin`). Invalid configured actions fail
configuration loading rather than navigating to another origin.

These identifiers express intent only. The destination must authenticate the
person, authorize the selected native workspace/conversation, and establish a
contribution through the native capability boundary before exposing an external
agent session. This form conveys no capability, accepted state, revision,
credentials or replicated workpiece. CF-OS retains its own collaborators,
gatekeepers, contribution proposals and acceptance history.
