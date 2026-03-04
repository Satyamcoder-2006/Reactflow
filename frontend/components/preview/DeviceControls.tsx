'use client';

import { Home, ArrowLeft, SquareStack, RefreshCw, Camera, Volume2, VolumeX } from 'lucide-react';

interface DeviceControlsProps {
    sessionId: string;
    /** Disable all controls when session is not yet LIVE */
    disabled?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function DeviceControls({ sessionId, disabled = false }: DeviceControlsProps) {
    const sendKey = async (keycode: string) => {
        if (disabled) return;

        await fetch(`${API_URL}/sessions/${sessionId}/input/key`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('token') ?? '' : ''}`,
            },
            body: JSON.stringify({ keycode }),
        }).catch((err) => {
            console.error('Failed to send key event:', err);
        });
    };

    const buttonClass = `flex flex-col items-center gap-2 p-4 rounded-md border border-border transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-accent cursor-pointer'}`;

    return (
        <div className="grid grid-cols-2 gap-3">
            {/* Home */}
            <button
                onClick={() => sendKey('KEYCODE_HOME')}
                disabled={disabled}
                className={buttonClass}
                title="Home (H)"
            >
                <Home className="h-5 w-5" />
                <span className="text-xs font-medium">Home</span>
            </button>

            {/* Back */}
            <button
                onClick={() => sendKey('KEYCODE_BACK')}
                disabled={disabled}
                className={buttonClass}
                title="Back (Esc)"
            >
                <ArrowLeft className="h-5 w-5" />
                <span className="text-xs font-medium">Back</span>
            </button>

            {/* App Switcher */}
            <button
                onClick={() => sendKey('KEYCODE_APP_SWITCH')}
                disabled={disabled}
                className={buttonClass}
                title="Recent Apps (Tab)"
            >
                <SquareStack className="h-5 w-5" />
                <span className="text-xs font-medium">Recents</span>
            </button>

            {/* Reload JS bundle (double-R) */}
            <button
                onClick={async () => {
                    await sendKey('KEYCODE_R');
                    await new Promise(r => setTimeout(r, 100));
                    await sendKey('KEYCODE_R');
                }}
                disabled={disabled}
                className={buttonClass}
                title="Reload JS bundle (R)"
            >
                <RefreshCw className="h-5 w-5" />
                <span className="text-xs font-medium">Reload</span>
            </button>

            {/* Volume Up */}
            <button
                onClick={() => sendKey('KEYCODE_VOLUME_UP')}
                disabled={disabled}
                className={buttonClass}
            >
                <Volume2 className="h-5 w-5" />
                <span className="text-xs font-medium">Vol+</span>
            </button>

            {/* Volume Down */}
            <button
                onClick={() => sendKey('KEYCODE_VOLUME_DOWN')}
                disabled={disabled}
                className={buttonClass}
            >
                <VolumeX className="h-5 w-5" />
                <span className="text-xs font-medium">Vol-</span>
            </button>

            {/* Screenshot */}
            <button
                onClick={async () => {
                    if (disabled) return;
                    const res = await fetch(`${API_URL}/sessions/${sessionId}/screen`, {
                        headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
                    });
                    if (!res.ok) return;
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `screenshot-${Date.now()}.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                }}
                disabled={disabled}
                className={`col-span-2 flex items-center justify-center gap-2 p-4 rounded-md border border-border transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-accent cursor-pointer'}`}
            >
                <Camera className="h-5 w-5" />
                <span className="text-xs font-medium">Take Screenshot</span>
            </button>
        </div>
    );
}
