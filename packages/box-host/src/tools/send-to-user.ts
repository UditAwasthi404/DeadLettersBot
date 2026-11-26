import type { InferenceTool } from "@agentos/inference";
import { z } from "zod";

export const SendToUserTool: InferenceTool = {
  name: "SendToUser",
  description: "Deliver a message to the user. Set endTurn=true when done.",
  parameters: z.object({
    content: z.string(),
    endTurn: z.boolean().optional().default(false),
  }),
};
