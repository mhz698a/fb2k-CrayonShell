function callbackAvailability(callbackName, description) {
    return (context) => ({
        available: typeof context?.[callbackName] === 'function',
        reason: description + ' no está disponible en este contexto.'
    });
}

export function registerCoreActivityBarActions(registry) {
    const unregister = [];

    unregister.push(registry.register({
        id: 'ui.toggleSidebar',
        label: 'Mostrar/ocultar panel izquierdo',
        category: 'Interfaz',
        description: 'Muestra u oculta ReFacets y Spectrum; también vuelve a esta vista desde Yearbook Explorer.',
        defaultIcon: 'columns',
        isAvailable: callbackAvailability('toggleSidebar', 'El control del panel izquierdo'),
        isActive: (context) => context.sidebarCollapsed === false && (context.sidebarView || 'library') === 'library',
        execute: (context) => context.toggleSidebar()
    }));

    unregister.push(registry.register({
        id: 'ui.toggleContentView',
        label: 'Alternar Playlist y Video',
        category: 'Interfaz',
        description: 'Alterna el contenido principal entre la playlist y el visor multimedia.',
        defaultIcon: 'video-camera',
        isAvailable: callbackAvailability('toggleContentView', 'El cambio de vista'),
        isActive: (context) => context.contentView === 'video',
        execute: (context) => context.toggleContentView()
    }));

    unregister.push(registry.register({
        id: 'playlist.manager.toggle',
        label: 'Gestor de playlists',
        category: 'Playlist',
        description: 'Muestra u oculta el panel lateral para activar, organizar y administrar playlists.',
        defaultIcon: 'list-ul',
        isAvailable: callbackAvailability('togglePlaylistManager', 'El gestor de playlists'),
        isActive: (context) => context.playlistManagerOpen === true,
        execute: (context) => context.togglePlaylistManager()
    }));

    unregister.push(registry.register({
        id: 'playlist.refresh',
        label: 'Actualizar playlist',
        category: 'Playlist',
        description: 'Solicita una actualización de la playlist activa.',
        defaultIcon: 'refresh',
        isAvailable: callbackAvailability('refreshPlaylist', 'La actualización de playlist'),
        execute: (context) => context.refreshPlaylist()
    }));

    unregister.push(registry.register({
        id: 'diagnostics.open',
        label: 'Abrir diagnóstico multimedia',
        category: 'Diagnóstico',
        description: 'Abre el panel de diagnóstico del visor multimedia.',
        defaultIcon: 'bug',
        isAvailable: callbackAvailability('openDiagnostics', 'El diálogo de diagnóstico'),
        execute: (context) => context.openDiagnostics()
    }));

    unregister.push(registry.register({
        id: 'externalTools.configure',
        label: 'Configurar herramientas externas',
        category: 'Herramientas externas',
        description: 'Configura Python y las rutas de los scripts FrameEtude, CatchEtude, AnuarySignature, NumHand, SMB y GalleryAnuary.',
        defaultIcon: 'wrench',
        isAvailable: callbackAvailability('openExternalToolsSettings', 'La configuración de herramientas externas'),
        isActive: (context) => context.externalToolsSettingsOpen === true,
        execute: (context) => context.openExternalToolsSettings()
    }));

    unregister.push(registry.register({
        id: 'activitybar.manage',
        label: 'Administrar ActivityBar',
        category: 'ActivityBar',
        description: 'Abre el administrador de botones, iconos y orden de ActivityBar.',
        defaultIcon: 'cogs',
        isAvailable: callbackAvailability('openActivityBarManager', 'El administrador de ActivityBar'),
        isActive: (context) => context.activityBarManagerOpen === true,
        execute: (context) => context.openActivityBarManager()
    }));

    return () => unregister.reverse().forEach((remove) => remove());
}
