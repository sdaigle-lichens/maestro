import type { Meta, StoryObj } from "@storybook/react-vite";
import FilePreview from "./file-preview";

const meta = {
  title: "ui/FilePreview",
  component: FilePreview,
  decorators: [
    (Story) => (
      <div className="h-96 w-[34rem]">
        <Story />
      </div>
    ),
  ],
  args: {
    filename: "SKILL.md",
    path: ".claude/skills/code-review/",
    lines: ["---", "name: code-review", "description: Reviews a diff.", "---", "", "# Code review"],
  },
} satisfies Meta<typeof FilePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const CustomLabel: Story = { args: { label: "Live preview" } };
