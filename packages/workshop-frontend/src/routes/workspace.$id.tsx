import { parseWorkspaceId } from '../workspaceSearch'
import { createFileRoute } from '@tanstack/react-router'
import GadgetEditor from '../GadgetEditor'

type GadgetSearch = {
  chat?: number
  // Selected workpiece (gadget) ID. Workpiece IDs start at 0, so parsing must not treat 0 as
  // absent.
  w?: number
}

export const Route = createFileRoute('/workspace/$id')({
  component: GadgetEditor,
  validateSearch: (search: Record<string, unknown>): GadgetSearch => ({
    chat: parseWorkspaceId(search.chat),
    w: parseWorkspaceId(search.w),
  }),
})
