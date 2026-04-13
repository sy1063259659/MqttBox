import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";

import {
  getDefaultParserScript,
  getParserHelpers,
  PARSER_MONACO_DECLARATIONS,
} from "@/features/parsers/helpers";
import { useI18n } from "@/lib/i18n";
import { useUiStore } from "@/stores/ui-store";

interface ParserScriptEditorProps {
  value: string;
  onChange: (value: string) => void;
}

let parserMonacoConfigured = false;
let currentParserHelpers = getParserHelpers("en-US");

function configureParserMonaco(monaco: Monaco) {
  if (parserMonacoConfigured) {
    return;
  }

  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    checkJs: true,
    target: monaco.languages.typescript.ScriptTarget.ES2020,
  });

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    PARSER_MONACO_DECLARATIONS,
    "ts:parser-runtime.d.ts",
  );

  monaco.languages.registerCompletionItemProvider("javascript", {
    triggerCharacters: ["."],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      if (!/helpers\.[\w]*$/.test(linePrefix)) {
        return { suggestions: [] };
      }

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
        suggestions: currentParserHelpers.map((helper) => ({
          label: helper.name,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: helper.insertText,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: helper.detail,
          documentation: {
            value: `\`${helper.signature}\`\n\n${helper.detail}\n\n${helper.documentation}\n\n${helper.example}`,
          },
          range,
        })),
      };
    },
  });

  parserMonacoConfigured = true;
}

export function ParserScriptEditor({
  value,
  onChange,
}: ParserScriptEditorProps) {
  const { locale } = useI18n();
  const theme = useUiStore((state) => state.theme);
  currentParserHelpers = getParserHelpers(locale);

  return (
    <div className="parser-monaco-shell">
      <Editor
        beforeMount={configureParserMonaco}
        defaultLanguage="javascript"
        defaultValue={getDefaultParserScript(locale)}
        height="320px"
        options={{
          automaticLayout: true,
          bracketPairColorization: {
            enabled: true,
          },
          fontFamily: "Cascadia Mono, JetBrains Mono, SF Mono, Consolas, monospace",
          fontSize: 12,
          lineHeight: 20,
          lineNumbersMinChars: 3,
          minimap: {
            enabled: false,
          },
          padding: {
            top: 12,
            bottom: 12,
          },
          scrollBeyondLastLine: false,
          tabSize: 2,
        }}
        theme={theme === "midnight" ? "vs-dark" : "vs"}
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? "")}
      />
    </div>
  );
}
