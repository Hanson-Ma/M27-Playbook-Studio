// The 3 / 6 / 9 cards-per-row switch, shared by a set's play cards and a formation's set cards (one setting for both).
import { useSettings } from "../../state/settings";
import { Segmented } from "../../ui";

export function CardColumnsPicker({ className, value, onChange }: { className?: string; value?: 3 | 6 | 9; onChange?(v: 3 | 6 | 9): void }) {
  const setting = useSettings((st) => st.cardColumns);
  const cardColumns = value ?? setting;
  return (
    <Segmented
      size="sm"
      className={className}
      aria-label="Cards per row"
      value={String(cardColumns)}
      options={[
        { value: "3", label: "3", title: "3 cards per row: one page of the in-game play-call screen" },
        { value: "6", label: "6", title: "6 cards per row" },
        { value: "9", label: "9", title: "9 cards per row" },
      ]}
      onChange={(v) => (onChange ? onChange(Number(v) as 3 | 6 | 9) : useSettings.getState().set({ cardColumns: Number(v) as 3 | 6 | 9 }))}
    />
  );
}
