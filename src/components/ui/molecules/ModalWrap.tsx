"use client"

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import IconButton from "../atoms/IconButton";

interface ModalWrapProps {
  children: React.ReactNode;
  onClose?: () => void;
  panelClassName?: string;
  showCloseButton?: boolean;
  overlayClassName?: string;
  ariaLabel?: string;
}

export default function ModalWrap({
  children,
  onClose,
  panelClassName,
  showCloseButton = false,
  overlayClassName = 'z-50',
  ariaLabel,
}: ModalWrapProps) {
  const router = useRouter();
  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    router.back();
  }, [onClose, router]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [handleClose]);

  return (
    <div
      className={`fixed inset-0 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm md:items-center md:p-6 ${overlayClassName}`}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl rounded-b-none border border-slate-700/60 bg-[#060b16]/95 shadow-[0_30px_80px_rgba(0,0,0,0.55)] [scrollbar-color:#475569_transparent] [scrollbar-width:thin] md:rounded-2xl [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600/80 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2 ${panelClassName ?? ''}`}
      >
        {showCloseButton && (
          <IconButton
            icon={<X size={18} />}
            variant="bg"
            onClick={handleClose}
            className="absolute right-4 top-4 z-20 ml-auto"
          />
        )}
        {children}
      </div>
    </div>
  );
}
