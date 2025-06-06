import Flickr from 'flickr-sdk';
import axios from 'axios';

const flickr = new Flickr(
  Flickr.OAuth.createPlugin(
    process.env.FLICKR_API_KEY,
    process.env.FLICKR_API_SECRET,
    process.env.FLICKR_ACCESS_TOKEN,
    process.env.FLICKR_ACCESS_SECRET
  )
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { dropboxUrl, title, description, eventName, albumName } = req.body;

  if (!dropboxUrl || !title || !eventName || !albumName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const fullAlbumTitle = `${eventName} – ${albumName}`;

  try {
    // Check if album already exists
    const { body: { photosets } } = await flickr.photosets.getList();
    const existingAlbum = photosets.photoset.find(
      (set) => set.title._content === fullAlbumTitle
    );

    let albumId = existingAlbum ? existingAlbum.id : null;

    // Download image
    const image = await axios.get(dropboxUrl, { responseType: 'stream' });

    // Upload photo
    const uploadRes = await flickr.upload({
      title,
      description,
      is_public: 0,
      photo: image.data,
    });

    const photoId = uploadRes.body.photoid._content;

    // If album does not exist, create it
    if (!albumId) {
      const createAlbumRes = await flickr.photosets.create({
        title: fullAlbumTitle,
        description: `Auto-created album for ${fullAlbumTitle}`,
        primary_photo_id: photoId,
      });
      albumId = createAlbumRes.body.photoset.id;
    } else {
      // Add photo to existing album
      await flickr.photosets.addPhoto({
        photoset_id: albumId,
        photo_id: photoId,
      });
    }

    return res.status(200).json({ success: true, photoId, albumId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
