import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import ModePill from "./mode-pill";

const options = [
  { value: "form", label: "Form" },
  { value: "yaml", label: "YAML" },
  { value: "preview", label: "Preview" },
];

const meta = { title: "ui/ModePill", component: ModePill } satisfies Meta<typeof ModePill>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { options, value: "form", onChange: () => {} },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <ModePill {...args} value={value} onChange={setValue} />;
  },
};
export const TwoOptions: Story = {
  args: { options: options.slice(0, 2), value: "form", onChange: () => {} },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <ModePill {...args} value={value} onChange={setValue} />;
  },
};
