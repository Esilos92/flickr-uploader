import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import Flickr from 'flickr-sdk';

const app = express();
app.use(express.json());

const flickr = new Flickr(process.env.FLICKR_ACCESS_TOKEN, process.env.FLICKR_ACCESS_SECRET);

app.post('/upload', async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { dropboxUrl, title, albumTitle, description } = req.body;

  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  try {
    const imageResponse = await axios.get(dropboxUrl, { responseType: 'stream' });

    const form = new FormData();
    form.append('photo', imageResponse.data, { filename: 'image.jpg' });
    form.append('title', title || 'Untitled');
    form.append('description', description || '');
    form.append('is_public', '0');

    const uploadResponse = await flickr.photos.upload(form);
    const photoId = uploadResponse.body.photoid._content;

    // Try to find or create the album
    const albums = await flickr.photosets.getList();
    let existingAlbum = albums.body.photosets.photoset.find(a => a.title._content === albumTitle);

    if (!existingAlbum) {
      const album = await flickr.photosets.create({
        title: albumTitle,
        primary_photo_id: photoId
      });
      existingAlbum = album.body.photoset;
    } else {
      await flickr.photosets.addPhoto({
        photoset_id: existingAlbum.id,
        photo_id: photoId
      });
    }

    return res.status(200).json({
      message: 'Upload successful',
      photoId,
      albumId: existingAlbum.id
    });

  } catch (err) {
    console.error('Upload failed:', err);
    return res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Uploader running on port ${PORT}`);
});
