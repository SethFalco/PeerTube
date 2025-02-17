import { updateTorrentMetadata } from '@server/helpers/webtorrent.js'
import { getServerActor } from '@server/models/application/application.js'
import { WEBSERVER } from '@server/initializers/constants.js'
import { initDatabaseModels } from '@server/initializers/database.js'
import {
  getLocalAccountActivityPubUrl,
  getLocalVideoActivityPubUrl,
  getLocalVideoAnnounceActivityPubUrl,
  getLocalVideoChannelActivityPubUrl,
  getLocalVideoCommentActivityPubUrl
} from '@server/lib/activitypub/url.js'
import { AccountModel } from '@server/models/account/account.js'
import { ActorFollowModel } from '@server/models/actor/actor-follow.js'
import { ActorModel } from '@server/models/actor/actor.js'
import { VideoChannelModel } from '@server/models/video/video-channel.js'
import { VideoCommentModel } from '@server/models/video/video-comment.js'
import { VideoShareModel } from '@server/models/video/video-share.js'
import { VideoModel } from '@server/models/video/video.js'

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(-1)
  })

async function run () {
  await initDatabaseModels(true)

  const serverAccount = await getServerActor()

  {
    const res = await ActorFollowModel.listAcceptedFollowingUrlsForApi([ serverAccount.id ], undefined)
    const hasFollowing = res.total > 0

    if (hasFollowing === true) {
      throw new Error('Cannot update host because you follow other servers!')
    }
  }

  console.log('Updating actors.')

  const actors: ActorModel[] = await ActorModel.unscoped().findAll({
    include: [
      {
        model: VideoChannelModel.unscoped(),
        required: false
      },
      {
        model: AccountModel.unscoped(),
        required: false
      }
    ]
  })
  for (const actor of actors) {
    if (actor.isOwned() === false) continue

    console.log('Updating actor ' + actor.url)

    const newUrl = actor.Account
      ? getLocalAccountActivityPubUrl(actor.preferredUsername)
      : getLocalVideoChannelActivityPubUrl(actor.preferredUsername)

    actor.url = newUrl
    actor.inboxUrl = newUrl + '/inbox'
    actor.outboxUrl = newUrl + '/outbox'
    actor.sharedInboxUrl = WEBSERVER.URL + '/inbox'
    actor.followersUrl = newUrl + '/followers'
    actor.followingUrl = newUrl + '/following'

    await actor.save()
  }

  console.log('Updating video shares.')

  const videoShares: VideoShareModel[] = await VideoShareModel.findAll({
    include: [ VideoModel.unscoped(), ActorModel.unscoped() ]
  })
  for (const videoShare of videoShares) {
    if (videoShare.Video.isOwned() === false) continue

    console.log('Updating video share ' + videoShare.url)

    videoShare.url = getLocalVideoAnnounceActivityPubUrl(videoShare.Actor, videoShare.Video)
    await videoShare.save()
  }

  console.log('Updating video comments.')
  const videoComments: VideoCommentModel[] = await VideoCommentModel.findAll({
    include: [
      {
        model: VideoModel.unscoped()
      },
      {
        model: AccountModel.unscoped(),
        include: [
          {
            model: ActorModel.unscoped()
          }
        ]
      }
    ]
  })
  for (const comment of videoComments) {
    if (comment.isOwned() === false) continue

    console.log('Updating comment ' + comment.url)

    comment.url = getLocalVideoCommentActivityPubUrl(comment.Video, comment)
    await comment.save()
  }

  console.log('Updating video and torrent files.')

  const ids = await VideoModel.listLocalIds()
  for (const id of ids) {
    const video = await VideoModel.loadFull(id)

    console.log('Updating video ' + video.uuid)

    video.url = getLocalVideoActivityPubUrl(video)
    await video.save()

    for (const file of video.VideoFiles) {
      console.log('Updating torrent file %s of video %s.', file.resolution, video.uuid)
      await updateTorrentMetadata(video, file)

      await file.save()
    }

    const playlist = video.getHLSPlaylist()
    for (const file of (playlist?.VideoFiles || [])) {
      console.log('Updating fragmented torrent file %s of video %s.', file.resolution, video.uuid)

      await updateTorrentMetadata(playlist, file)

      await file.save()
    }
  }
}
