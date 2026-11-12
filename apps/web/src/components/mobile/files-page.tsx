import type { Me } from "@ember/protocol";
import { EmptyList, TabPage, TabTitle, YouLink } from "./tab-page";

/** Files on a phone: the files shared in your conversations. */
export function FilesPage({ me }: { me: Me }) {
  return (
    <TabPage heading={<TabTitle>Files</TabTitle>} actions={<YouLink me={me} />}>
      <EmptyList>Files shared in your conversations will be listed here.</EmptyList>
    </TabPage>
  );
}
