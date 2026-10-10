import type { Meta, StoryObj } from "@storybook/react-vite";
import SyntaxLine from "./syntax-line";

const meta = { title: "ui/SyntaxLine", component: SyntaxLine } satisfies Meta<typeof SyntaxLine>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Yaml: Story = { args: { raw: "name: code-reviewer" } };
export const Divider: Story = { args: { raw: "---" } };
export const Json: Story = { args: { raw: '  "name": "code-reviewer",' } };
