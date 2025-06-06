// index.js — Fully Vercel-compatible using flickr-sdk@7.0.0-beta.9

import Flickr from 'flickr-sdk';
import axios from 'axios';
import FormData from 'form-data';

const FLICKR_API_KEY = process.env.FLICKR_API_KEY;
const FLICKR_API_SECRET = process.env.FLICKR_API_SECRET;
const FLICKR_ACCESS_TOKEN = process.env.FLICKR_ACCESS_TOKEN;
const FLICKR_ACCESS_TOKEN_SECRET = process.env.FLICKR_ACCESS_TOKEN_SECRET;

const flickr = new Flickr(Flickr.OAuth.createPlugin(
  FLICKR_API_KEY,
  FLICKR_API_SECRET,
  FLICKR_ACCESS_TOKEN,
  FLICKR_ACCESS_TOKEN_SECRET
));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { dropboxUrl, title, description = '', albumTitle = '' } = req.body;

  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  try {
    const imageResponse = await axios.get(dropboxUrl, { responseType: 'stream' });
    const form = new FormData();
    form.append('photo', imageResponse.data, { filename: 'upload.jpg' });
    form.append('title', title);
    form.append('description', description);
    form.append('is_public', '0');

    const uploadResponse = await flickr.request().media('upload', {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    const photoId = uploadResponse.body.photoid._content;

    const albums = await flickr.photosets.getList({ user_id: 'me' });
    let album = albums.body.photosets.photoset.find(ps => ps.title._content === albumTitle);

    if (!album) {
      const createRes = await flickr.photosets.create({
        title: albumTitle,
        primary_photo_id: photoId
      });
      album = createRes.body.photoset;
    } else {
      await flickr.photosets.addPhoto({
        photoset_id: album.id,
        photo_id: photoId
      });
    }

    return res.status(200).json({ success: true, photoId, albumId: album.id });
  } catch (err) {
    console.error('Upload failed:', err);
    return res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
}
