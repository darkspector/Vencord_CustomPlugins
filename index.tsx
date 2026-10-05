import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Forms, GuildStore, RestAPI, SearchableSelect, showToast, useEffect, useState, UserStore, VoiceStateStore } from "@webpack/common";

const logger = new Logger("ChannelConnectSound");

// Delay before playing on join — lets the RTC connection establish, since the
// send-soundboard-sound API requires you to actually be connected.
const JOIN_DELAY_MS = 1000;
const DEFAULT_VOLUME = 0.5;

// NOTE: Verify this URL in Discord DevTools — open Network tab, play a soundboard
// sound manually, and confirm the CDN request URL format.
function soundPreviewUrl(soundId: string) {
    return `https://cdn.discordapp.com/soundboard-sounds/${soundId}`;
}

interface SoundboardSound {
    sound_id: string;
    name: string;
    guild_id?: string;
    emoji_name?: string | null;
}

interface Mapping {
    guildId: string;
    guildName: string;
    soundId: string;
    soundName: string;
    emoji?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseMappings(): Mapping[] {
    try {
        return JSON.parse(settings.store.mappings || "[]");
    } catch (e) {
        logger.warn("Failed to parse stored mappings, resetting to empty", e);
        return [];
    }
}

// Plays the sound locally via the CDN. Returns true on success, false on failure.
async function previewSound(soundId: string, soundName: string, showErrorToast = false): Promise<boolean> {
    const audio = new Audio(soundPreviewUrl(soundId));
    audio.volume = settings.store.volume ?? DEFAULT_VOLUME;
    try {
        await audio.play();
        return true;
    } catch (e) {
        logger.warn("Local playback failed", e);
        if (showErrorToast) {
            showToast(`ChannelConnectSound: could not play "${soundName}" — CDN URL may have changed`, "failure");
        }
        return false;
    }
}

// ─── settings component ───────────────────────────────────────────────────────

function SoundMappingManager() {
    const [mappings, setMappings] = useState<Mapping[]>(parseMappings);

    const [newGuildId, setNewGuildId] = useState<string | undefined>(undefined);
    const [newSounds, setNewSounds] = useState<SoundboardSound[]>([]);
    const [newSoundId, setNewSoundId] = useState<string | undefined>(undefined);
    const [loading, setLoading] = useState(false);

    const guilds = Object.values(GuildStore.getGuilds())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(g => ({
            label: mappings.some(m => m.guildId === g.id) ? `${g.name} ✓` : g.name,
            value: g.id,
        }));

    useEffect(() => {
        if (!newGuildId) { setNewSounds([]); setNewSoundId(undefined); return; }
        setLoading(true);
        RestAPI.get({ url: `/guilds/${newGuildId}/soundboard-sounds` })
            .then(res => { setNewSounds(res.body?.items ?? []); setLoading(false); })
            .catch(e => { logger.warn("Failed to fetch soundboard sounds", e); setLoading(false); });
    }, [newGuildId]);

    const soundOptions = newSounds.map(s => ({
        label: s.emoji_name ? `${s.emoji_name} ${s.name}` : s.name,
        value: s.sound_id,
    }));

    function saveMappings(updated: Mapping[]) {
        setMappings(updated);
        settings.store.mappings = JSON.stringify(updated);
    }

    function removeMapping(guildId: string) {
        saveMappings(mappings.filter(m => m.guildId !== guildId));
    }

    function addMapping() {
        if (!newGuildId || !newSoundId) return;
        const guild = GuildStore.getGuild(newGuildId);
        const sound = newSounds.find(s => s.sound_id === newSoundId);
        if (!guild || !sound) return;

        const updated = [
            ...mappings.filter(m => m.guildId !== newGuildId),
            {
                guildId: newGuildId,
                guildName: guild.name,
                soundId: newSoundId,
                soundName: sound.name,
                emoji: sound.emoji_name ?? undefined,
            },
        ].sort((a, b) => a.guildName.localeCompare(b.guildName));

        saveMappings(updated);
        setNewGuildId(undefined);
        setNewSoundId(undefined);
        setNewSounds([]);
    }

    const canAdd = !!newGuildId && !!newSoundId && !loading;
    const isReplace = !!newGuildId && mappings.some(m => m.guildId === newGuildId);
    const previewCandidate = newSoundId ? newSounds.find(s => s.sound_id === newSoundId) : null;

    return (
        <div>
            {/* Configured mappings */}
            {mappings.length === 0 ? (
                <Forms.FormText style={{ marginBottom: 8 }}>
                    No servers configured yet — add one below.
                </Forms.FormText>
            ) : (
                <div style={{ marginBottom: 16 }}>
                    {mappings.map(m => (
                        <div key={m.guildId} style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "7px 10px", marginBottom: 4,
                            background: "var(--background-secondary)", borderRadius: 4,
                        }}>
                            <Forms.FormText>
                                <strong>{m.guildName}</strong>
                                <span style={{ color: "var(--text-muted)", margin: "0 8px" }}>→</span>
                                {m.emoji ? `${m.emoji} ` : ""}{m.soundName}
                            </Forms.FormText>
                            <div style={{ display: "flex", gap: 6 }}>
                                <Button
                                    size="small"
                                    variant="secondary"
                                    onClick={() => previewSound(m.soundId, m.soundName, true)}
                                >▶</Button>
                                <Button
                                    size="small"
                                    variant="dangerSecondary"
                                    onClick={() => removeMapping(m.guildId)}
                                >Remove</Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add / replace form */}
            <Forms.FormTitle>Add / Replace</Forms.FormTitle>
            <SearchableSelect
                placeholder="Select a server..."
                options={guilds}
                value={newGuildId}
                onChange={v => { setNewGuildId(v); setNewSoundId(undefined); }}
                maxVisibleItems={8}
                closeOnSelect
            />

            <Forms.FormTitle style={{ marginTop: 8 }}>Sound</Forms.FormTitle>
            <SearchableSelect
                placeholder={loading ? "Loading…" : !newGuildId ? "Select a server first" : newSounds.length === 0 ? "No sounds in this server" : "Select a sound..."}
                options={soundOptions}
                value={newSoundId}
                onChange={v => setNewSoundId(v)}
                maxVisibleItems={8}
                closeOnSelect
                isDisabled={!newGuildId || loading}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <Button
                    disabled={!canAdd}
                    onClick={addMapping}
                >
                    {isReplace ? "Replace" : "Add"}
                </Button>
                {previewCandidate && (
                    <Button
                        variant="secondary"
                        onClick={() => previewSound(previewCandidate.sound_id, previewCandidate.name, true)}
                    >▶ Preview</Button>
                )}
            </div>
        </div>
    );
}

// ─── plugin ───────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    soundMappings: {
        type: OptionType.COMPONENT,
        description: "Configure which soundboard sound plays per server when you join a voice channel",
        component: SoundMappingManager,
    },
    volume: {
        type: OptionType.SLIDER,
        description: "Local playback volume (only affects what you hear — others hear it at their own soundboard volume)",
        default: DEFAULT_VOLUME,
        markers: [0, 0.25, 0.5, 0.75, 1],
        stickToMarkers: false,
    },
    mappings: {
        type: OptionType.STRING,
        description: "",
        default: "[]",
        hidden: true,
    },
});

export default definePlugin({
    name: "ChannelConnectSound",
    description: "Automatically plays a server soundboard sound when you join a voice channel — everyone in the channel hears it",
    // Set id to your Discord user ID (as a BigInt, e.g. 123456789012345678n) for your avatar to show
    authors: [{ name: "Chris", id: 0n }],
    settings,

    flux: {
        VOICE_CHANNEL_SELECT({ channelId, guildId, currentVoiceChannelId }: { channelId: string | null; guildId: string | null; currentVoiceChannelId: string | null; }) {
            if (!channelId) return;

            // Already in this channel — the event also fires when re-selecting it
            // (e.g. clicking to watch a stream). Don't replay the sound.
            if (currentVoiceChannelId === channelId) return;

            // guildId is not always present in the event — look it up from the channel store
            const resolvedGuildId = guildId ?? ChannelStore.getChannel(channelId)?.guild_id;
            if (!resolvedGuildId) return;

            // If currentVoiceChannelId is set we're switching channels — always play.
            // If null we're joining fresh on this client — check for multi-device (already
            // connected to this same channel on another device/session).
            if (!currentVoiceChannelId) {
                const myId = UserStore.getCurrentUser()?.id;
                if (myId && VoiceStateStore.getVoiceStateForUser(myId)?.channelId === channelId) return;
            }

            const entry = parseMappings().find(m => m.guildId === resolvedGuildId);
            if (!entry) return;

            // Delay both so local playback and the channel broadcast fire in sync
            setTimeout(async () => {
                // Bail if we've since left or switched away from this channel — otherwise
                // a rapid switch would fire a stale sound and a spurious error toast
                const myId = UserStore.getCurrentUser()?.id;
                if (!myId || VoiceStateStore.getVoiceStateForUser(myId)?.channelId !== channelId) return;

                // Play locally; if it fails it shows its own toast, and we suppress
                // the API error toast below so only one fires
                const errorShown = !(await previewSound(entry.soundId, entry.soundName, true));

                try {
                    await RestAPI.post({
                        url: `/channels/${channelId}/send-soundboard-sound`,
                        body: { sound_id: entry.soundId, source_guild_id: entry.guildId },
                    });
                } catch (e: any) {
                    logger.warn("send-soundboard-sound failed", e);
                    if (!errorShown && e?.status >= 400 && e?.status < 500) {
                        const msg = e?.status === 429
                            ? "ChannelConnectSound: rate limited — slow down your joins"
                            : e?.body?.code === 50168
                                ? "ChannelConnectSound: not connected to channel yet — try increasing the delay"
                                : `ChannelConnectSound: "${entry.soundName}" no longer exists in ${entry.guildName} — update your settings`;
                        showToast(msg, "failure");
                    }
                }
            }, JOIN_DELAY_MS);
        },
    },
});
