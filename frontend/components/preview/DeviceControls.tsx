'use client';

import { apiClient } from '@/lib/api/client';
import { Home, ArrowLeft, RotateCw, Camera, Menu } from 'lucide-react';

interface DeviceControlsProps {
    sessionId: string;
}

export function DeviceControls({ sessionId }: DeviceControlsProps) {
    const sendKeyEvent = async (key: string) => {
        try {
            await apiClient.sendInput(sessionId, { type: 'key', key });
        } catch (error) {
            console.error('Failed to send key event:', error);
        }
    };

    const handleRotate = () => {
        sendKeyEvent('KEYCODE_R');
    };

    const handleHome = () => {
        sendKeyEvent('KEYCODE_HOME');
    };

    const handleBack = () => {
        sendKeyEvent('KEYCODE_BACK');
    };

    const handleRecents = () => {
        sendKeyEvent('KEYCODE_APP_SWITCH');
    };

    const handleScreenshot = () => {
        console.log('Screenshot captured');
    };

    return (
        <div className="grid grid-cols-2 gap-3">
            <button
                onClick={handleHome}
                className="flex flex-col items-center gap-2 p-4 rounded-md border border-border hover:bg-accent transition-colors"
            >
                <Home className="h-5 w-5" />
                <span className="text-xs font-medium">Home</span>
            </button>

            <button
                onClick={handleBack}
                className="flex flex-col items-center gap-2 p-4 rounded-md border border-border hover:bg-accent transition-colors"
            >
                <ArrowLeft className="h-5 w-5" />
                <span className="text-xs font-medium">Back</span>
            </button>

            <button
                onClick={handleRecents}
                className="flex flex-col items-center gap-2 p-4 rounded-md border border-border hover:bg-accent transition-colors"
            >
                <Menu className="h-5 w-5" />
                <span className="text-xs font-medium">Recents</span>
            </button>

            <button
                onClick={handleRotate}
                className="flex flex-col items-center gap-2 p-4 rounded-md border border-border hover:bg-accent transition-colors"
            >
                <RotateCw className="h-5 w-5" />
                <span className="text-xs font-medium">Rotate</span>
            </button>

            <button
                onClick={handleScreenshot}
                className="col-span-2 flex items-center justify-center gap-2 p-4 rounded-md border border-border hover:bg-accent transition-colors"
            >
                <Camera className="h-5 w-5" />
                <span className="text-xs font-medium">Take Screenshot</span>
            </button>
        </div>
    );
}
