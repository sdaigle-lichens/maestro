import type { Meta, StoryObj } from "@storybook/react-vite";
import Button from "./button";

const meta = { title: "ui/Button", component: Button, args: { children: "Create skill" } } satisfies Meta<
  typeof Button
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Loading: Story = { args: { variant: "primary", loading: true } };
export const Disabled: Story = { args: { variant: "secondary", disabled: true } };
