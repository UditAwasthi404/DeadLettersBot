/** Detect when the model is chatting instead of operating the VM desktop. */

const DESKTOP_TASK =
  /\b(canva|youtube|playlist|browser|website|web page|open\b|navigate|click|type\b|login|sign[\s-]?in|google docs?|gmail|fill(?:\s+out)?|download|upload|create\s+a|make\s+a|edit\s+a|send\s+(?:an?\s+)?(?:email|message)|chrome|terminal)\b/i;

const CHATBOT_REFUSAL =
  /i don'?t have access|add them yourself|create .{0,40}yourself|you can create|in your youtube|listed are good ones|do it yourself|open .{0,40}yourself|add them in your|from your account|i cannot create|i can'?t create|good ones to add/i;

export function userLikelyWantsDesktop(prompt: string): boolean {
  return DESKTOP_TASK.test(prompt);
}

export function looksLikeDesktopRefusal(content: string): boolean {
  if (CHATBOT_REFUSAL.test(content)) return true;
  return /youtube\.com\/watch/i.test(content) && /playlist|yourself|add them|create/i.test(content);
}

export function shouldNudgeDesktopUse(opts: {
  desktopUsedThisTurn: boolean;
  nudgeAlreadySent: boolean;
  userPrompt: string;
  sendToUserContents: string[];
  endTurn: boolean;
}): boolean {
  if (opts.desktopUsedThisTurn || opts.nudgeAlreadySent) return false;
  if (!opts.endTurn && opts.sendToUserContents.length === 0) return false;
  if (userLikelyWantsDesktop(opts.userPrompt)) return true;
  return opts.sendToUserContents.some((content) => looksLikeDesktopRefusal(content));
}

export const DESKTOP_NUDGE_MESSAGE =
  '[AgentOS runtime]\nYou sent chat text (or listed links) without operating the desktop. That is wrong.\nThe user asked you to DO the task on their agent computer — not to paste YouTube links or say "add them yourself".\nImmediately call Computer:\n1) action "plan" with steps to finish their request on the live screen\n2) action "navigate" or "new_tab" with the real site URL (e.g. https://www.youtube.com/ or https://www.canva.com/)\n3) screenshot, then click/type until the playlist/design/task exists\nIf YouTube/Canva needs login, call SecureHandoff, then continue after they return control.\nDo not SendToUser a list of video URLs. Do not tell the user to do it in their app.';
