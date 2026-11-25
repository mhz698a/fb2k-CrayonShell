import { useCallback, useState } from 'react';
import {
    loadExternalToolsConfig,
    saveExternalToolsConfig
} from '../config/externalTools.js';

export function useExternalToolsConfig() {
    const [config, setConfig] = useState(loadExternalToolsConfig);

    const saveConfig = useCallback((nextConfig) => {
        const saved = saveExternalToolsConfig(nextConfig);
        setConfig(saved);
        return saved;
    }, []);

    return { config, saveConfig };
}
