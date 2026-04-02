export function isEnabled(manifest, name) {
    if (!manifest.enabled || manifest.enabled.length === 0)
        return true;
    return manifest.enabled.includes(name);
}
