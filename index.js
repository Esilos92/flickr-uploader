import { createFlickr } from 'flickr-sdk';
import axios from 'axios';

const { flickr, upload } = createFlickr({
  consumerKey: process.env.FLICKR_API_KEY,
  consumerSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_ACCESS_TOKEN,
  oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { dropboxUrl, title = '', description = '', albumTitle = '' } = req.body;

  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  try {
    // Step 1: Download image
    const imageResponse = await axios.get(dropboxUrl, { responseType: 'arraybuffer' });

    // Step 2: Upload photo
    const photoId = await upload(imageResponse.data, {
      title,
      description,
      is_public: 0,
    });

    // Step 3: Check for existing album
    const albums = await flickr('flickr.photosets.getList', {});
    const existingAlbum = albums.photosets.photoset.find(
      (set) => set.title._content.toLowerCase() === albumTitle.toLowerCase()
    );

    let albumId;
    if (existingAlbum) {
      albumId = existingAlbum.id;
    } else {
      // Step 4: Create new album
      const newAlbum = await flickr('flickr.photosets.create', {
        title: albumTitle,
        primary_photo_id: photoId,
      });
      albumId = newAlbum.photoset.id;
    }

    // Step 5: Add photo to album (if not already added during creation)
    if (existingAlbum) {
      await flickr('flickr.photosets.addPhoto', {
        photoset_id: albumId,
        photo_id: photoId,
      });
    }

    return res.status(200).json({ success: true, photoId, albumId });
  } catch (err) {
    console.error('Upload failed:', err);
    return res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
}
