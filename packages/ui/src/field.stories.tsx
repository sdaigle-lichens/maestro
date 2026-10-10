import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Field, Input, Textarea } from "./field";

const meta = { title: "ui/Field", component: Field } satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ error, mono }: { error?: string | null; mono?: boolean }) {
  const [value, setValue] = useState("code-reviewer");
  return (
    <div className="w-80">
      <Field id="name" label="Name" hint="Lowercase, hyphenated." error={error}>
        <Input id="name" value={value} onChange={setValue} mono={mono} error={error} />
      </Field>
    </div>
  );
}

export const Default: Story = { args: { label: "Name", children: null }, render: () => <Controlled /> };
export const Mono: Story = { args: { label: "Name", children: null }, render: () => <Controlled mono /> };
export const WithError: Story = {
  args: { label: "Name", children: null },
  render: () => <Controlled error="A skill with this name already exists." />,
};
export const MultiLine: Story = {
  args: { label: "Description", children: null },
  render: () => {
    const [value, setValue] = useState("Reviews a diff for correctness and style.");
    return (
      <div className="w-80">
        <Field id="desc" label="Description">
          <Textarea id="desc" value={value} onChange={setValue} />
        </Field>
      </div>
    );
  },
};
