// First open of the editor: offer to create a new playbook. FUSION (Hanson Ma's working playbook) ships with the project
// as the example, so "Look Around First" just keeps it open. Shown once (settings.welcomed).
import { useSettings } from "../../state/settings";
import { useWorkspace } from "../../state/workspace";
import { Button, Modal } from "../../ui";
import { newPlaybook } from "./books";

export function Welcome() {
  const ready = useWorkspace((st) => st.ready);
  const welcomed = useSettings((st) => st.welcomed);
  const done = () => useSettings.getState().set({ welcomed: true });
  const create = (stock: boolean) => {
    done();
    void newPlaybook(stock);
  };
  return (
    <Modal
      open={ready && !welcomed}
      onClose={done}
      eyebrow="Welcome"
      title="Create Your Playbook"
      width="md"
      footer={
        <>
          <Button onClick={done}>Look Around First</Button>
          <Button icon="download" onClick={() => create(true)}>
            New From Stock Template
          </Button>
          <Button variant="primary" icon="plus" onClick={() => create(false)}>
            New Playbook
          </Button>
        </>
      }
    >
      <p>
        A playbook is the list of formations, sets and plays you'll see in Madden. Start your own now: empty, or from the game's stock
        playbook so you can trim it down.
      </p>
      <p>
        <b>FUSION</b> is Hanson Ma's working playbook, included as an example to look through. Your own playbook is a separate file, so
        nothing you do there changes it.
      </p>
    </Modal>
  );
}
