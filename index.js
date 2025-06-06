// index.js - Simplified handler for single uploads via Make.com
const { createFlickr } = require('flickr-sdk');
const { tmpdir } = require('os');
const { join, parse } = require('path');
const { writeFile, unlink } = require('fs/promises');
const fetch = require('node-fetch');

// Initialize Flickr SDK
const { flickr, upload } = createFlickr({
  consumerKey: process.env.FLICKR_API_KEY,
  consumerSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_ACCESS_TOKEN,
  oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
});

const userId = process.env.FLICKR_USER_ID;

module.exports = async function handler(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  // Health check for GET requests to root
  if (req.method === 'GET' && pathname === '/') {
    return res.status(200).send('Flickr uploader running');
  }

  // Handle POST requests to /upload
  if (req.method === 'POST' && pathname === '/upload') {
    return await handleUpload(req, res);
  }

  // 404 for unmatched routes
  return res.status(404).json({ error: 'Not found' });
};

// Single upload handler (simplified for Make.com iterator)
async function handleUpload(req, res) {
  try {
    const { imageUrl, dropboxUrl, albumPath, albumTitle, title, description, tags } = req.body;

    // Support both imageUrl (original) and dropboxUrl (new)
    const sourceUrl = dropboxUrl || imageUrl;
    
    if (!sourceUrl) {
      return res.status(400).json({ error: 'Missing imageUrl or dropboxUrl' });
    }

    // Support both albumPath (original format) and albumTitle (direct)
    let finalAlbumTitle;
    if (albumTitle) {
      finalAlbumTitle = albumTitle;
    } else if (albumPath) {
      const parts = albumPath.split('/').filter(Boolean);
      const eventName = parts[0] || 'Uncategorized Event';
      const albumName = parts[1] || 'General';
      finalAlbumTitle = `${eventName} -- ${albumName}`;
    } else {
      return res.status(400).json({ error: 'Missing albumPath or albumTitle' });
    }

    console.log('Processing upload from URL:', sourceUrl);
    console.log('Target album:', finalAlbumTitle);

    // Download image from URL
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract filename from URL or use provided title
    const urlParts = new URL(sourceUrl);
    const pathParts = urlParts.pathname.split('/');
    const originalFileName = pathParts[pathParts.length - 1] || 'image.jpg';
    const fileName = title ? `${title}.${getFileExtension(originalFileName)}` : originalFileName;

    const tempFilePath = join(tmpdir(), fileName);
    await writeFile(tempFilePath, buffer);

    try {
      const photoTitle = title || parse(fileName).name;
      
      // Upload photo as private
      const photoId = await upload(tempFilePath, {
        title: photoTitle,
        description: description || '',
        tags: tags || '',
        is_public: 0,  // Private
        is_friend: 0,
        is_family: 0
      });

      console.log('Photo uploaded with ID:', photoId);

      // Find or create album and add photo
      const albumId = await findOrCreateAlbum(finalAlbumTitle, photoId);
      
      // Add photo to album if it's an existing album
      if (albumId) {
        try {
          const existingAlbumId = await findExistingAlbum(finalAlbumTitle);
          if (existingAlbumId && existingAlbumId === albumId) {
            // Album existed before, so add this photo to it
            await flickr('flickr.photosets.addPhoto', {
              photoset_id: albumId,
              photo_id: photoId,
            });
            console.log('Photo added to existing album');
          }
          // If album was just created, photo is already the primary photo
        } catch (addPhotoError) {
          console.log('Note: Could not add photo to album:', addPhotoError.message);
        }
      }

      const result = {
        success: true,
        photoId: photoId,
        albumId: albumId,
        albumTitle: finalAlbumTitle,
        flickrUrl: `https://www.flickr.com/photos/${userId}/${photoId}`,
        albumUrl: albumId ? `https://www.flickr.com/photos/${userId}/albums/${albumId}` : null
      };

      // Return response in original format for Make.com compatibility
      res.json({ 
        message: 'Photo uploaded', 
        result: result
      });

    } finally {
      // Clean up temp file
      await unlink(tempFilePath);
    }

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
}

// Helper function to find existing album (case-insensitive)
async function findExistingAlbum(albumTitle) {
  try {
    const res = await flickr('flickr.photosets.getList', { 
      user_id: userId 
    });
    
    if (!res.photosets || !res.photosets.photoset) {
      return null;
    }
    
    const existingAlbum = res.photosets.photoset.find(
      set => set.title._content.toLowerCase() === albumTitle.toLowerCase()
    );
    
    return existingAlbum ? existingAlbum.id : null;
  } catch (error) {
    console.error('Error finding existing album:', error);
    return null;
  }
}

// Helper function to find or create album
async function findOrCreateAlbum(albumTitle, primaryPhotoId) {
  try {
    console.log('Looking for album:', albumTitle);
    
    const existingAlbumId = await findExistingAlbum(albumTitle);
    if (existingAlbumId) {
      console.log('Found existing album:', albumTitle, 'with ID:', existingAlbumId);
      return existingAlbumId;
    }

    console.log('Creating new album:', albumTitle);
    return await createNewAlbum(albumTitle, primaryPhotoId);
  } catch (error) {
    console.error('Error with album operations:', error);
    throw new Error(`Album operation failed: ${error.message}`);
  }
}

// Helper function to create new album (private)
async function createNewAlbum(albumTitle, primaryPhotoId) {
  try {
    const res = await flickr('flickr.photosets.create', {
      title: albumTitle,
      primary_photo_id: primaryPhotoId,
      description: `Album: ${albumTitle}`
    });

    console.log('Created new private album:', albumTitle, 'with ID:', res.photoset.id);
    return res.photoset.id;
  } catch (error) {
    console.error('Error creating album:', error);
    throw new Error(`Failed to create album: ${error.message}`);
  }
}

// Helper function to get file extension
function getFileExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : 'jpg';
}
