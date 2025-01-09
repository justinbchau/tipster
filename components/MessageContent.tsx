import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { Plugin } from 'unified';

const remarkSpacing: Plugin = () => (tree) => {
  visit(tree, (node: any) => {
    if (
      node.type === 'paragraph' || 
      node.type === 'list' || 
      node.type === 'listItem' ||
      node.type === 'text'
    ) {
      node.position = {
        ...node.position,
        indent: [0]
      };
    }
  });
};

export function MessageContent({ content }: { content: string }) {
  return (
    <div>
      <Markdown
        className="prose dark:prose-invert max-w-none"
        remarkPlugins={[
          remarkGfm,
          remarkSpacing
        ]}
        components={{
          a: ({ href, ...props }) => (
            <a
              {...props}
              href={href}
              className="text-blue-500 hover:text-blue-600 underline"
              target="_blank"
              rel="noopener noreferrer"
            />
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
} 