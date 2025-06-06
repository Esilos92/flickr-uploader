// index.js - Main handler compatible with your vercel.json
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

module.exports = handler;
async function handler(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  // Health check for GET requests to root
  if (req.method === 'GET' && pathname === '/') {
    return res.status(200).send('Flickr uploader running');
  }

  // Handle POST requests to /upload
  if (req.method === 'POST' && pathname === '/upload') {
    return await handleUpload(req, res);
  }

  // Handle POST requests to /batch (new endpoint)
  if (req.method === 'POST' && pathname === '/batch') {
    return await handleBatchUpload(req, res);
  }

  // 404 for unmatched routes
  return res.status(404).json({ error: 'Not found' });
}

// Single upload handler (your original functionality + Dropbox URL support)
async function handleUpload(req, res) {
  try {
    const { imageUrl, dropboxUrl, albumPath, albumTitle, title, description, tags } = req.body;

    // Support both imageUrl (your original) and dropboxUrl (new)
    const sourceUrl = dropboxUrl || imageUrl;
    
    if (!sourceUrl) {
      return res.status(400).json({ error: 'Missing imageUrl or dropboxUrl' });
    }

    // Support both albumPath (your original format) and albumTitle (direct)
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
      
      const photoId = await upload(tempFilePath, {
        title: photoTitle,
        description: description || '',
        tags: tags || '',
        is_public: 0,
        is_friend: 0,
        is_family: 0
      });

      console.log('Photo uploaded with ID:', photoId);

      // Find or create album and add photo
      const albumId = await findOrCreateAlbum(finalAlbumTitle, photoId);
      
      // Add photo to album if it's not the primary photo of a new album
      if (albumId) {
        try {
          const existingAlbumId = await findExistingAlbum(finalAlbumTitle);
          if (existingAlbumId) {
            // Album existed, so add this photo to it
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

      // Return response in your original format
      res.json({ 
        message: 'Photo uploaded', 
        result: result
      });

    } finally {
      await unlink(tempFilePath);
    }

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
}

// Batch upload handler for multiple files
async function handleBatchUpload(req, res) {
  try {
    const { files, albumTitle, albumPath } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required with dropboxUrl for each file' });
    }

    // Support both albumPath and albumTitle formats
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

    console.log(`Processing batch upload of ${files.length} files to album: ${finalAlbumTitle}`);

    const results = [];
    let albumId = null;
    let isNewAlbum = false;

    // Check if album already exists
    const existingAlbumId = await findExistingAlbum(finalAlbumTitle);
    if (existingAlbumId) {
      albumId = existingAlbumId;
      console.log('Using existing album:', finalAlbumTitle);
    } else {
      isNewAlbum = true;
      console.log('Will create new album:', finalAlbumTitle);
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const sourceUrl = file.dropboxUrl || file.imageUrl;
      
      if (!sourceUrl) {
        results.push({
          success: false,
          fileName: `file_${i + 1}`,
          error: 'Missing dropboxUrl or imageUrl'
        });
        continue;
      }

      console.log(`Processing file ${i + 1}/${files.length}: ${sourceUrl}`);

      try {
        // Download file
        const response = await fetch(sourceUrl);
        if (!response.ok) {
          throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);

        // Extract filename
        const urlParts = new URL(sourceUrl);
        const pathParts = urlParts.pathname.split('/');
        const originalFileName = pathParts[pathParts.length - 1] || `image_${i + 1}.jpg`;
        const fileName = file.title ? `${file.title}.${getFileExtension(originalFileName)}` : originalFileName;

        // Create temp file
        const tempFilePath = join(tmpdir(), fileName);
        await writeFile(tempFilePath, fileBuffer);

        try {
          // Upload to Flickr
          const photoTitle = file.title || parse(fileName).name;
          const photoId = await upload(tempFilePath, {
            title: photoTitle,
            description: file.description || '',
            tags: file.tags || '',
            is_public: 0,
            is_friend: 0,
            is_family: 0
          });

          console.log(`Uploaded photo ${i + 1} with ID:`, photoId);

          // Handle album creation/addition
          if (isNewAlbum && i === 0) {
            // Create new album with first photo as primary
            albumId = await createNewAlbum(finalAlbumTitle, photoId);
            isNewAlbum = false;
          } else if (albumId) {
            // Add photo to existing album
            try {
              await flickr('flickr.photosets.addPhoto', {
                photoset_id: albumId,
                photo_id: photoId,
              });
              console.log(`Added photo ${i + 1} to album`);
            } catch (addError) {
              console.warn(`Could not add photo ${i + 1} to album:`, addError.message);
            }
          }

          results.push({
            success: true,
            fileName: fileName,
            photoId: photoId,
            flickrUrl: `https://www.flickr.com/photos/${userId}/${photoId}`
          });

        } finally {
          await unlink(tempFilePath);
        }

      } catch (fileError) {
        console.error(`Error processing file ${i + 1}:`, fileError);
        results.push({
          success: false,
          fileName: sourceUrl,
          error: fileError.message
        });
      }

      // Add delay between uploads to avoid rate limiting
      if (i < files.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    res.status(200).json({
      message: `Batch upload completed: ${successCount} successful, ${failCount} failed`,
      result: {
        success: true,
        albumTitle: finalAlbumTitle,
        albumId: albumId,
        totalFiles: files.length,
        successCount: successCount,
        failCount: failCount,
        results: results,
        albumUrl: albumId ? `https://www.flickr.com/photos/${userId}/albums/${albumId}` : null
      }
    });

  } catch (error) {
    console.error('Batch upload error:', error);
    res.status(500).json({ 
      error: 'Batch upload failed', 
      details: error.message 
    });
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

// Helper function to create new album
async function createNewAlbum(albumTitle, primaryPhotoId) {
  try {
    const res = await flickr('flickr.photosets.create', {
      title: albumTitle,
      primary_photo_id: primaryPhotoId,
      description: `Album: ${albumTitle}`
    });

    console.log('Created new album:', albumTitle, 'with ID:', res.photoset.id);
    
    // Set album privacy to private
    try {
      await flickr('flickr.photosets.editMeta', {
        photoset_id: res.photoset.id,
        title: albumTitle,
        description: `Album: ${albumTitle}`
      });
      console.log('Album privacy set to private');
    } catch (privacyError) {
      console.warn('Could not set album privacy (album still created):', privacyError.message);
    }
    
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
