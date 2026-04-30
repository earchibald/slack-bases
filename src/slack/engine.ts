import type { RenderValues, TextReplacement } from './types';
import { detectCandidates } from './detector';
import { buildTargetUrl, renderSmartLink } from './renderer';

interface EngineResolver {
  resolveChannelRef(value: string): Promise<{ channelId: string; name: string; teamId: string } | null>;
  resolveDmSentinel(value: string): Promise<{ displayName: string; teamId: string; userId: string } | null>;
  resolvePermalink(value: string): Promise<RenderValues>;
}

interface EngineSettings {
  enableChannels: boolean;
  enableDmSentinels: boolean;
  enablePermalinks: boolean;
  messageTemplate: string;
  target: 'app' | 'web';
}

export async function planSlackLinkReplacements(
  text: string,
  input: {
    cursorOffset: number;
    resolver: EngineResolver;
    settings: EngineSettings;
  }
): Promise<TextReplacement[]> {
  const candidates = detectCandidates(text, { cursorOffset: input.cursorOffset });
  const replacements: TextReplacement[] = [];

  for (const candidate of candidates) {
    if (candidate.kind === 'message-permalink' && input.settings.enablePermalinks) {
      const values = await input.resolver.resolvePermalink(candidate.value);
      replacements.push({
        end: candidate.end,
        start: candidate.start,
        text: renderSmartLink(input.settings.messageTemplate, {
          ...values,
          url: values.url ?? candidate.value,
        }),
      });
      continue;
    }

    if (candidate.kind === 'channel-ref' && input.settings.enableChannels) {
      const resolved = await input.resolver.resolveChannelRef(candidate.value);

      if (resolved) {
        replacements.push({
          end: candidate.end,
          start: candidate.start,
          text: `[#${resolved.name}](${buildTargetUrl({
            channelId: resolved.channelId,
            target: input.settings.target,
            teamId: resolved.teamId,
          })})`,
        });
      }

      continue;
    }

    if (candidate.kind === 'dm-sentinel' && input.settings.enableDmSentinels) {
      const resolved = await input.resolver.resolveDmSentinel(candidate.value);

      if (resolved) {
        replacements.push({
          end: candidate.end,
          start: candidate.start,
          text: `[DM ${resolved.displayName}](${buildUserTargetUrl(resolved.teamId, resolved.userId)})`,
        });
      }
    }
  }

  return replacements;
}

function buildUserTargetUrl(teamId: string, userId: string): string {
  return `slack://user?team=${teamId}&id=${userId}`;
}
