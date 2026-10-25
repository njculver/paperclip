import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownBody } from "@/components/MarkdownBody";

const meta: Meta<typeof MarkdownBody> = {
  title: "Markdown/Mermaid",
  component: MarkdownBody,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof MarkdownBody>;

export const ValidFlowchart: Story = {
  args: {
    children: [
      "```mermaid",
      "flowchart TD",
      "  A[Assign work] --> B[Run agent]",
      "  B --> C{Needs review?}",
      "  C -->|Yes| D[Request approval]",
      "  C -->|No| E[Complete issue]",
      "```",
    ].join("\n"),
  },
};

export const InvalidDiagram: Story = {
  args: {
    children: ["```mermaid", "this is not a Mermaid diagram", "```"].join("\n"),
  },
};
