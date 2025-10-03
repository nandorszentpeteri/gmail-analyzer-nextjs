'use client'

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'

interface ConfirmDialog {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
}

interface ConfirmDialogContextType {
  confirm: (dialog: ConfirmDialog) => void
  confirmPromise: (title: string, message: string, options?: { confirmText?: string; cancelText?: string; variant?: 'danger' | 'warning' | 'info' }) => Promise<boolean>
  confirmDelete: (itemCount: number, onConfirm: () => void | Promise<void>) => void
}

const ConfirmDialogContext = createContext<ConfirmDialogContextType | null>(null)

export const useConfirmDialog = () => {
  const context = useContext(ConfirmDialogContext)
  if (!context) {
    throw new Error('useConfirmDialog must be used within a ConfirmDialogProvider')
  }
  return context
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ConfirmDialog | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const confirm = useCallback((dialog: ConfirmDialog) => {
    setDialog(dialog)
  }, [])

  const confirmPromise = useCallback((title: string, message: string, options?: { confirmText?: string; cancelText?: string; variant?: 'danger' | 'warning' | 'info' }) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        title,
        message,
        confirmText: options?.confirmText || 'Confirm',
        cancelText: options?.cancelText || 'Cancel',
        variant: options?.variant || 'info',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  }, [])

  const confirmDelete = useCallback((itemCount: number, onConfirm: () => void | Promise<void>) => {
    confirm({
      title: 'Delete Emails',
      message: `Are you sure you want to delete ${itemCount} email${itemCount !== 1 ? 's' : ''}? They will be moved to trash.`,
      confirmText: `Delete ${itemCount} Email${itemCount !== 1 ? 's' : ''}`,
      cancelText: 'Cancel',
      variant: 'danger',
      onConfirm
    })
  }, [confirm])

  const handleConfirm = async () => {
    if (!dialog) return

    setIsLoading(true)
    try {
      await dialog.onConfirm()
      setDialog(null)
    } catch (error) {
      console.error('Confirm action failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    if (isLoading) return
    dialog?.onCancel?.()
    setDialog(null)
  }

  return (
    <ConfirmDialogContext.Provider value={{ confirm, confirmPromise, confirmDelete }}>
      {children}
      {dialog && (
        <ConfirmDialogModal
          dialog={dialog}
          isLoading={isLoading}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmDialogContext.Provider>
  )
}

function ConfirmDialogModal({
  dialog,
  isLoading,
  onConfirm,
  onCancel
}: {
  dialog: ConfirmDialog
  isLoading: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const variant = dialog.variant || 'info'

  const variants = {
    danger: {
      icon: Trash2,
      iconColor: 'text-red-600',
      confirmButton: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    },
    warning: {
      icon: AlertTriangle,
      iconColor: 'text-yellow-600',
      confirmButton: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
    },
    info: {
      icon: AlertTriangle,
      iconColor: 'text-blue-600',
      confirmButton: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
    }
  }

  const config = variants[variant]
  const Icon = config.icon

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <div className={`flex items-center justify-center w-10 h-10 rounded-full bg-gray-100`}>
              <Icon className={`h-5 w-5 ${config.iconColor}`} />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{dialog.title}</h3>
          </div>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-gray-700">{dialog.message}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t bg-gray-50">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {dialog.cancelText || 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`
              px-4 py-2 text-sm font-medium text-white rounded-md focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed
              ${config.confirmButton}
              ${isLoading ? 'cursor-wait' : ''}
            `}
          >
            {isLoading ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Processing...</span>
              </div>
            ) : (
              dialog.confirmText || 'Confirm'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}