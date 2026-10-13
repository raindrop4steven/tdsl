import { useMemo } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';

export type Lang = 'tsx' | 'typescript' | 'json' | 'java' | 'bash';

interface Props {
  code: string;
  lang: Lang;
  className?: string;
}

export function Code({ code, lang, className }: Props) {
  const html = useMemo(() => {
    const grammar = Prism.languages[lang] ?? Prism.languages.plaintext;
    return Prism.highlight(code, grammar, lang);
  }, [code, lang]);

  return (
    <pre className={className}>
      <code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
