import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addToPlaylist,
  apiError,
  createPlaylist,
  getPlaylist,
  getPlaylists,
  libraryCoverUrl,
  libraryFileUrl,
  streamUrl,
  type Playlist,
  type PlaylistTrack,
  type PlaylistTrackInput,
  type Recommendation,
  type Track,
} from './api'
import { useMessages } from './i18n'
import type { QueueItem } from './player'
import { useToast } from './toast'

export const playlistsKey = ['playlists'] as const
export const playlistKey = (id: string) => ['playlist', id] as const

export function usePlaylists(enabled = true) {
  return useQuery({
    queryKey: playlistsKey,
    queryFn: getPlaylists,
    staleTime: 15_000,
    retry: false,
    enabled,
  })
}

export function usePlaylist(id: string | null) {
  return useQuery({
    queryKey: playlistKey(id ?? ''),
    queryFn: () => getPlaylist(id!),
    enabled: id !== null,
    staleTime: 15_000,
    retry: false,
  })
}

/** Refetch every playlist view after a change. The list's counts and covers
 *  are derived server-side, so a change to one playlist is a change to it. */
export function useRefreshPlaylists() {
  const client = useQueryClient()
  return useCallback(
    (playlist?: Playlist) => {
      if (playlist) client.setQueryData(playlistKey(playlist.id), playlist)
      void client.invalidateQueries({ queryKey: playlistsKey })
    },
    [client],
  )
}

/** Add songs to an existing playlist, or to a new one named `name`, and say
 *  what happened — including "it was already there", which is the answer
 *  to pressing + twice and should not read as an error. */
export function useAddToPlaylist() {
  const m = useMessages()
  const { push } = useToast()
  const refresh = useRefreshPlaylists()
  return useMutation({
    mutationFn: async ({
      target,
      songs,
    }: {
      target: { id: string; name: string } | { create: string }
      songs: PlaylistTrackInput[]
    }) => {
      if ('create' in target) {
        const playlist = await createPlaylist(target.create, songs)
        return { playlist, added: playlist.tracks.length, skipped: 0, created: true }
      }
      return { ...(await addToPlaylist(target.id, songs)), created: false }
    },
    onSuccess: ({ playlist, added, created }) => {
      refresh(playlist)
      if (created) push(m.playlists.savedAs(playlist.name), 'success')
      else if (added === 0) push(m.playlists.alreadyThere(playlist.name), 'info')
      else push(m.playlists.added(added, playlist.name), 'success')
    },
    onError: (err) => push(apiError(err, m), 'error'),
  })
}

/** One playlist row as the player wants it: from disk when it's there, from
 *  the stream when it isn't. */
export function playlistQueueItem(entry: PlaylistTrack): QueueItem {
  const song: PlaylistTrackInput = {
    title: entry.title,
    artists: entry.artists,
    album: entry.album,
    duration_ms: entry.duration_ms,
    cover_url: entry.cover_url,
    source_url: entry.source_url,
  }
  const base = {
    title: entry.title,
    artist: entry.artists.join(', '),
    album: entry.album,
    duration_ms: entry.duration_ms,
    coverUrl: entry.cover ?? undefined,
    hasCover: Boolean(entry.cover),
    song,
  }
  if (entry.file_id) {
    return {
      ...base,
      id: entry.file_id,
      url: libraryFileUrl(entry.file_id),
      coverUrl: entry.cover ?? libraryCoverUrl(entry.file_id),
    }
  }
  return { ...base, id: `stream:${entry.uid}`, url: streamUrl(song), online: true }
}

/** A catalog track — a search hit, an album row — played in full online. */
export function streamQueueItem(track: Track): QueueItem {
  return {
    id: `stream:${track.id}`,
    title: track.title,
    artist: track.artists.join(', '),
    album: track.album,
    duration_ms: track.duration_ms,
    url: streamUrl(track),
    coverUrl: track.cover_url ?? undefined,
    hasCover: Boolean(track.cover_url),
    online: true,
    song: {
      title: track.title,
      artists: track.artists,
      album: track.album,
      duration_ms: track.duration_ms,
      cover_url: track.cover_url,
      source_url: track.source_url,
    },
  }
}

/** An autoplay suggestion as the player wants it: the file when it's on
 *  disk, the stream when it isn't — and marked, so the queue can show it
 *  apart from what the person queued themselves. */
export function recommendationQueueItem(rec: Recommendation): QueueItem {
  const song: PlaylistTrackInput = {
    title: rec.title,
    artists: rec.artists,
    album: rec.album,
    duration_ms: rec.duration_ms,
    cover_url: rec.cover_url,
    source_url: rec.source_url,
  }
  const base = {
    title: rec.title,
    artist: rec.artists.join(', '),
    album: rec.album,
    duration_ms: rec.duration_ms,
    coverUrl: rec.cover_url ?? undefined,
    hasCover: Boolean(rec.cover_url),
    song,
    auto: true,
  }
  if (rec.file_id) {
    return {
      ...base,
      id: rec.file_id,
      url: libraryFileUrl(rec.file_id),
      coverUrl: rec.cover_url ?? libraryCoverUrl(rec.file_id),
      hasCover: true,
    }
  }
  return { ...base, id: `stream:auto:${rec.id}`, url: streamUrl(song), online: true }
}
