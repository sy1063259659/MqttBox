import { Bot, CheckCircle2, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AgentContextDto, AgentToolDescriptor } from "@/features/agent/types";
import { useI18n } from "@/lib/i18n";

interface AgentPanelProps {
  context: AgentContextDto | null;
  tools: AgentToolDescriptor[];
  statusMessage: string | null;
}

export function AgentPanel({ context, tools, statusMessage }: AgentPanelProps) {
  const { t } = useI18n();

  return (
    <section className="flex h-full flex-col gap-4 p-4 text-sm">
      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Bot className="size-3.5 text-primary" />
          {t("agent.context")}
        </div>
        <div className="space-y-1 text-[12px] text-muted-foreground">
          <div>
            {t("agent.currentConnection", {
              value: context?.activeConnectionId ?? t("common.noneSelected"),
            })}
          </div>
          <div>
            {t("agent.selectedTopic", {
              value: context?.selectedTopic ?? t("common.noneSelected"),
            })}
          </div>
          <div>{t("agent.recentMessages", { value: context?.recentMessages ?? 0 })}</div>
          <div>
            {t("agent.connectionHealth", {
              value: context?.connectionHealth ?? t("status.idle"),
            })}
          </div>
        </div>
      </div>

      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Wrench className="size-3.5 text-primary" />
          {t("agent.tools")}
        </div>
        <div className="space-y-2">
          {tools.map((tool) => (
            <div key={tool.id} className="desktop-inset rounded-md p-2.5">
              <div className="text-[12px] font-medium text-foreground">{tool.name}</div>
              <div className="text-[11px] text-muted-foreground">{tool.description}</div>
            </div>
          ))}
        </div>
      </div>
      {statusMessage ? (
        <Badge variant="success" className="w-fit gap-1">
          <CheckCircle2 className="size-3" />
          {statusMessage}
        </Badge>
      ) : null}
    </section>
  );
}
