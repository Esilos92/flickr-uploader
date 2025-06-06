// index.js
import { createFlickr } from "flickr-sdk"
import FormData from 'form-data';
import fetch from 'node-fetch';

const flickr = new Flickr({
  apiKey: process.env.FLICKR_API_KEY,
  apiSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_ACCESS_TOKEN,
  oauthTokenSecret: process.env.FLICKR_ACCESS_TOKEN_SECRET,
});

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const { imageUrl, albumTitle, albumDescription } = request.body;

  if (!imageUrl || !albumTitle) {
    return response.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Step 1: Check if album already exists
    const albums = await flickr.photosets.getList();
    let existingAlbum = albums.body.photosets.photoset.find(
      (set) => set.title._content.toLowerCase() === albumTitle.toLowerCase()
    );

    // Step 2: Upload image
    const uploadResult = await flickr.upload({
      title: albumTitle,
      description: 'Uploaded via automation 🔁',
      photo: imageUrl,
      is_public: 0,
    });

    const photoId = uploadResult.body.photoid._content;

    // Step 3: Create album if it doesn’t exist
    if (!existingAlbum) {
      const albumResult = await flickr.photosets.create({
        title: albumTitle,
        description: albumDescription || '',
        primary_photo_id: photoId,
      });
      existingAlbum = albumResult.body.photoset;
    } else {
      // Step 4: Add to existing album
      await flickr.photosets.addPhoto({
        photoset_id: existingAlbum.id,
        photo_id: photoId,
      });
    }

    response.status(200).json({ success: true, photoId });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
