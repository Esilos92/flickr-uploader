import Flickr from 'flickr-sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { dropboxUrl, albumTitle } = req.body;

  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  const flickr = new Flickr({
    apiKey: process.env.FLICKR_API_KEY,
    apiSecret: process.env.FLICKR_API_SECRET,
    accessToken: process.env.FLICKR_ACCESS_TOKEN,
    accessTokenSecret: process.env.FLICKR_ACCESS_TOKEN_SECRET,
  });

  try {
    // Upload photo from Dropbox URL
    const uploadResponse = await flickr.upload({
      photo: dropboxUrl,
      is_public: 0,
      title: albumTitle,
    });

    const photoId = uploadResponse.body.photoid._content;

    // Get list of existing albums
    const albums = await flickr.photosets.getList({ user_id: 'me' });

    let existingAlbum = albums.body.photosets.photoset.find(
      (set) => set.title._content === albumTitle
    );

    let albumId;

    if (existingAlbum) {
      albumId = existingAlbum.id;
    } else {
      const createAlbum = await flickr.photosets.create({
        title: albumTitle,
        primary_photo_id: photoId,
      });
      albumId = createAlbum.body.photoset.id;
    }

    // Add photo to the album
    await flickr.photosets.addPhoto({
      photoset_id: albumId,
      photo_id: photoId,
    });

    return res.status(200).json({
      success: true,
      message: 'Photo uploaded and added to album',
      photoId,
      albumId,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
