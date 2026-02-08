import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS classes with clsx and tailwind-merge.
 * This ensures that conflicting Tailwind classes are resolved correctly.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Formats a date string or object into a human-readable format.
 * Default format: "MMM D, YYYY"
 */
export function formatDate(date: string | number | Date): string {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(date));
}

/**
 * Truncates a string to a specified length and adds an ellipsis.
 */
export function truncate(str: string, length: number): string {
    if (str.length <= length) return str;
    return str.slice(0, length) + '...';
}

/**
 * Copies text to the clipboard.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy text: ', err);
        return false;
    }
}
