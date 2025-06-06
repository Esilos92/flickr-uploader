import { Flickr } from 'flickr-sdk';
import axios from 'axios';
import FormData from 'form-data';

const flickr = new Flickr(
  process.env.FLICKR_ACCESS_TOKEN,
  process.env.FLICKR_ACCESS_SECRET
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { dropboxUrl, title = 'Untitled', description = '', albumTitle = 'Default Album' } = req.body;

  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  try {
    // Fetch image stream from Dropbox
    const imageResponse = await axios.get(dropboxUrl, { responseType: 'stream' });

    const form = new FormData();
    form.append('photo', imageResponse.data, { filename: 'upload.jpg' });
    form.append('title', title);
    form.append('description', description);
    form.append('is_public', 0);
    form.append('hidden', 2); // prevents it from appearing publicly in searches/feed

    // Upload the photo
    const uploadResponse = await flickr.photos.upload(form, {
      headers: form.getHeaders(),
    });

    const photoId = uploadResponse.body.photoid._content;

    // Check for existing album
    const albums = await flickr.photosets.getList();
    let targetAlbum = albums.body.photosets.photoset.find(set => set.title._content === albumTitle);

    // Create album if needed
    if (!targetAlbum) {
      const albumRes = await flickr.photosets.create({
        title: albumTitle,
        primary_photo_id: photoId,
      });
      targetAlbum = albumRes.body.photoset;
    } else {
      // Add photo to existing album
      await flickr.photosets.addPhoto({
        photoset_id: targetAlbum.id,
        photo_id: photoId,
      });
    }

    return res.status(200).json({
      success: true,
      photoId,
      albumId: targetAlbum.id,
      albumTitle: targetAlbum.title._content,
    });
  } catch (err) {
    console.error('UPLOAD FAILED:', err?.response?.data || err?.message || err);
    return res.status(500).json({
      error: 'Upload failed',
      detail: err?.response?.data || err?.message || 'Unknown error',
    });
  }
}
