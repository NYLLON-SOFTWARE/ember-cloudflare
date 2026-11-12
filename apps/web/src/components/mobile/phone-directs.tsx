import type { ReactNode } from "react";
import type { Me } from "@ember/protocol";
import { useTitle } from "@/hooks/use-title";
import { DirectsTitleContext } from "../workspace/directs-title";
import { NewMessageButton, TabPage, TabTitle, YouLink } from "./tab-page";

interface Props {
  me: Me;
  /** The DMs page's list, which the desktop shows beside the DM open. */
  list: ReactNode;
  onNewDirect: (opener: HTMLElement) => void;
}

/**
 * DMs on a phone, Slack's: "DMs" and your avatar at the top, the DMs page's list, each DM with its latest
 * message, and New direct message floating over its bottom right.
 */
export function PhoneDirects({ me, list, onNewDirect }: Props) {
  useTitle("Direct messages");
  return (
    <TabPage heading={<TabTitle>DMs</TabTitle>} actions={<YouLink me={me} />} floating={<NewMessageButton onNewDirect={onNewDirect} />}>
      {/* The list's own title and compose give way to the page's. */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]">
        <DirectsTitleContext value={false}>{list}</DirectsTitleContext>
      </div>
    </TabPage>
  );
}
