import type { Meta, StoryObj } from "@storybook/react-vite";
import CopyableText from "./copyable-text";

const meta = {
  title: "ui/CopyableText",
  component: CopyableText,
  decorators: [
    (Story) => (
      <div className="p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CopyableText>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { text: "/maestro-install", children: <code className="font-mono text-[13px]">/maestro-install</code> },
};
export const CopiedCue: Story = {
  args: {
    text: "pnpm install",
    children: (copied: boolean) => <code className="font-mono text-[13px]">{copied ? "Copied" : "pnpm install"}</code>,
  },
};
