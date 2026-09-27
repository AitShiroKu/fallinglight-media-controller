import { create } from 'zustand';

export interface FileItem {
  name: string;
  folder: string;
  path: string;
  size: number;
  sizeFormatted: string;
  extension: string;
  isVideo: boolean;
  modifiedAt: string;
}

export interface FolderItem {
  name: string;
  path: string;
  fileCount: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
}

interface FileState {
  files: FileItem[];
  folders: FolderItem[];
  currentFolder: string;
  searchQuery: string;
  isLoading: boolean;
  isUploading: boolean;
  uploadProgress: number;
  uploadStatusText: string;
  draggedFilePath: string | null;

  // Actions
  loadFiles: (folder?: string) => Promise<void>;
  navigateTo: (folder: string) => void;
  setSearchQuery: (query: string) => void;
  createFolder: (name: string) => Promise<boolean>;
  deleteFolder: (folderPath: string) => Promise<boolean>;
  moveFile: (sourcePath: string, targetFolder: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
  uploadFiles: (files: FileList | File[], targetFolder?: string) => Promise<boolean>;
  setDraggedFilePath: (path: string | null) => void;
}

export const useFileStore = create<FileState>((set, get) => ({
  files: [],
  folders: [],
  currentFolder: '',
  searchQuery: '',
  isLoading: false,
  isUploading: false,
  uploadProgress: 0,
  uploadStatusText: '',
  draggedFilePath: null,

  loadFiles: async (folder) => {
    const target = folder !== undefined ? folder : get().currentFolder;
    set({ isLoading: true, currentFolder: target });
    try {
      const res = await fetch('/api/files?folder=' + encodeURIComponent(target));
      const data = await res.json();
      set({
        files: data.files || [],
        folders: data.folders || [],
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to load files:', err);
      set({ isLoading: false });
    }
  },

  navigateTo: (folder) => {
    get().loadFiles(folder);
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  createFolder: async (name) => {
    try {
      const res = await fetch('/api/files/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent: get().currentFolder }),
      });
      const data = await res.json();
      if (data.success) {
        await get().loadFiles();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  deleteFolder: async (folderPath) => {
    try {
      const res = await fetch('/api/files/folder/' + encodeURIComponent(folderPath), {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        if (get().currentFolder === folderPath || get().currentFolder.startsWith(folderPath + '/')) {
          set({ currentFolder: '' });
        }
        await get().loadFiles();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  moveFile: async (sourcePath, targetFolder) => {
    try {
      const res = await fetch('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: sourcePath, targetFolder }),
      });
      const data = await res.json();
      if (data.success) {
        await get().loadFiles();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  deleteFile: async (filePath) => {
    try {
      const res = await fetch('/api/files/' + encodeURIComponent(filePath), {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        await get().loadFiles();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  uploadFiles: async (fileList, targetFolder) => {
    if (!fileList || fileList.length === 0) return false;
    const target = targetFolder !== undefined ? targetFolder : get().currentFolder;
    set({ isUploading: true, uploadProgress: 0, uploadStatusText: `Uploading ${fileList.length} file(s)...` });

    const formData = new FormData();
    formData.append('folder', target);
    for (let i = 0; i < fileList.length; i++) {
      formData.append('file', fileList[i]);
    }

    return new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload', true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          set({ uploadProgress: percent });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          set({ uploadProgress: 100, uploadStatusText: 'Upload complete!' });
          get().loadFiles(get().currentFolder);
          setTimeout(() => set({ isUploading: false, uploadProgress: 0, uploadStatusText: '' }), 2500);
          resolve(true);
        } else {
          set({ uploadProgress: 0, uploadStatusText: 'Upload failed' });
          setTimeout(() => set({ isUploading: false }), 3000);
          resolve(false);
        }
      };

      xhr.onerror = () => {
        set({ uploadProgress: 0, uploadStatusText: 'Connection error' });
        setTimeout(() => set({ isUploading: false }), 3000);
        resolve(false);
      };

      xhr.send(formData);
    });
  },

  setDraggedFilePath: (path) => {
    set({ draggedFilePath: path });
  },
}));
