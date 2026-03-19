/**
 * ExpandableCard — wraps content in a card that opens a fullscreen modal on click.
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  children: React.ReactNode;
}

export function ExpandableCard({ children }: Props) {
  const [expanded, setExpanded] = useState(false);

  const open = useCallback(() => setExpanded(true), []);
  const close = useCallback(() => setExpanded(false), []);

  return (
    <>
      <div className="card card--expandable" onClick={open} title="Click to enlarge">
        {children}
      </div>

      {expanded && createPortal(
        <div className="table-modal-overlay" onClick={close}>
          <div className="table-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="table-modal-close" onClick={close} aria-label="Close">
              &times;
            </button>
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
