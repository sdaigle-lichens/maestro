import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import ChipInput from "./chip-input";

const meta = { title: "ui/ChipInput", component: ChipInput } satisfies Meta<typeof ChipInput>;
export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ initial }: { initial: string[] }) {
  const [values, setValues] = useState(initial);
  return (
    <div className="w-96">
      <ChipInput values={values} onChange={setValues} placeholder="Add a tool, press Enter" />
    </div>
  );
}

export const Default: Story = {
  args: { values: [], onChange: () => {} },
  render: () => <Controlled initial={["Read", "Grep"]} />,
};
export const Empty: Story = { args: { values: [], onChange: () => {} }, render: () => <Controlled initial={[]} /> };
