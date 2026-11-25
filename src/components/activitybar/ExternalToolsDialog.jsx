import { useEffect, useRef, useState } from 'react';
import { DEFAULT_EXTERNAL_TOOLS_CONFIG } from '../../features/activitybar/config/externalTools.js';

const FIELDS = [
    {
        key: 'pythonExecutable',
        label: 'Intérprete Python',
        description: 'Ejecutable usado para iniciar las herramientas. Puede ser pythonw.exe si está en PATH.',
        placeholder: 'pythonw.exe'
    },
    {
        key: 'frameEtudeScript',
        label: 'FrameEtude',
        description: 'Script principal de FrameEtude.',
        placeholder: 'Ruta completa a frame_etude.pyw'
    },
    {
        key: 'catchEtudeScript',
        label: 'CatchEtude',
        description: 'Script principal de CatchEtude.',
        placeholder: 'Ruta completa a catchetude.pyw'
    },
    {
        key: 'anuarySignatureScript',
        label: 'AnuarySignature',
        description: 'Script principal de AnuarySignature.',
        placeholder: 'Ruta completa a app.py'
    },
    {
        key: 'numHandScript',
        label: 'NumHand',
        description: 'Script que recibe la ruta del archivo seleccionado.',
        placeholder: 'Ruta completa a main.py'
    },
    {
        key: 'smbYearScript',
        label: 'Conectar año a SMB',
        description: 'Script que recibe la ruta del archivo seleccionado.',
        placeholder: 'Ruta completa al diálogo SMB'
    },
    {
        key: 'galleryAnuaryScript',
        label: 'GalleryAnuary',
        description: 'Script que recibe la ruta de la carpeta .album elegida en Yearbook Explorer.',
        placeholder: 'Ruta completa a app.py'
    },
    {
        key: 'internalBasePath',
        label: 'Raíz de Yearbook Explorer',
        description: 'Carpeta que contiene las carpetas organizadas por año.',
        placeholder: 'E:\\_Internal'
    },
    {
        key: 'recycleBinPath',
        label: 'Carpeta de reciclaje heredada',
        description: 'Ruta que abre la opción Open Recycle Bin del menú NumHand.',
        placeholder: 'E:\\_Exclude\\l_reallydeleted'
    }
];

export default function ExternalToolsDialog({ open, config, onClose, onSave }) {
    const dialogRef = useRef(null);
    const [draft, setDraft] = useState({ ...DEFAULT_EXTERNAL_TOOLS_CONFIG });
    const [message, setMessage] = useState('');

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open) {
            setDraft({ ...DEFAULT_EXTERNAL_TOOLS_CONFIG, ...config });
            setMessage('');
            if (!dialog.open) dialog.showModal();
        } else if (dialog.open) {
            dialog.close();
        }
    }, [open, config]);

    function updateField(key, value) {
        setDraft((current) => ({ ...current, [key]: value }));
    }

    function handleSubmit(event) {
        event.preventDefault();
        try {
            onSave(draft);
            setMessage('Configuración guardada.');
            onClose();
        } catch (error) {
            setMessage(error?.message || 'No se pudo guardar la configuración.');
        }
    }

    return (
        <dialog
            ref={dialogRef}
            className="activitybar-manager-dialog external-tools-dialog"
            aria-labelledby="ExternalToolsTitle"
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClose={onClose}
        >
            <form className="activitybar-manager external-tools-form" onSubmit={handleSubmit}>
                <header className="activitybar-manager-heading">
                    <div>
                        <strong id="ExternalToolsTitle">Configurar herramientas externas</strong>
                        <span>Define los ejecutables y scripts que ActivityBar puede iniciar.</span>
                    </div>
                    <button
                        className="activitybar-manager-close"
                        type="button"
                        aria-label="Cerrar configuración"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </header>

                <section className="activitybar-manager-section external-tools-fields">
                    {FIELDS.map((field) => (
                        <label className="external-tools-field" key={field.key}>
                            <span>{field.label}</span>
                            <input
                                type="text"
                                value={draft[field.key] || ''}
                                placeholder={field.placeholder}
                                onChange={(event) => updateField(field.key, event.target.value)}
                                spellCheck={false}
                                autoComplete="off"
                            />
                            <small>{field.description}</small>
                        </label>
                    ))}
                </section>

                {message && (
                    <p className="activitybar-manager-import-message" role="status">{message}</p>
                )}

                <footer className="activitybar-manager-footer">
                    <span>Las rutas se guardan en la configuración local de esta plantilla.</span>
                    <div>
                        <button type="button" onClick={onClose}>Cancelar</button>
                        <button className="activitybar-manager-primary" type="submit">Guardar</button>
                    </div>
                </footer>
            </form>
        </dialog>
    );
}
