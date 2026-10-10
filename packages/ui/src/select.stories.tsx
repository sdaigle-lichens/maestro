import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import Select from "./select";

const options = [
  { id: "opus", name: "Opus", desc: "Most capable" },
  { id: "sonnet", name: "Sonnet", desc: "Balanced" },
  { id: "haiku", name: "Haiku", desc: "Fastest" },
];

const meta = {
  title: "ui/Select",
  component: Select,
  args: { options, value: "sonnet", onChange: () => {} },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return (
      <div className="w-72">
        <Select {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};
export const Placeholder: Story = {
  render: (args) => (
    <div className="w-72">
      <Select {...args} value="" placeholder="Pick a model" />
    </div>
  ),
};
