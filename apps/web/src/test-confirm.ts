import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Answers the app's own dialog titled `title` (useConfirm in confirm-dialog.tsx) with its `button`, Cancel or the one that goes ahead. */
export async function answerConfirm(user: UserEvent, title: string, button: string): Promise<void> {
  const dialog = await screen.findByRole("alertdialog", { name: title });
  await user.click(within(dialog).getByRole("button", { name: button }));
}
