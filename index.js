// api/transfer.js - Vercel serverless function for Dropbox links to Flickr
import { createFlickr } from 'flickr-sdk';
import { tmpdir } from 'os';
import { join, parse } from 'path';
import { writeFile, unlink } from 'fs/promises';
import fetch from 'node-fetch';

// Initialize Flickr SDK
const { flickr, upload } = createFlickr({
  consumerKey: process.env.FLICKR_API_KEY,
  consumerSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_ACCESS_TOKEN,
  oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
});

const userId = process.env.FLICKR_USER_ID;

export default async function handler(req, res) {
  // Health check for GET requests
  if (req.method === 'GET') {
    return res.status(200).send('Dropbox to Flickr transfer service running');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dropboxUrl, albumTitle, title, description, tags } = req.body;

    if (!dropboxUrl) {
      return res.status(400).json({ error: 'dropboxUrl is required' });
    }

    if (!albumTitle) {
      return res.status(400).json({ error: 'albumTitle is required' });
    }

    console.log('Processing download from Dropbox URL:', dropboxUrl);

    // Download file from Dropbox URL
    const response = await fetch(dropboxUrl);
    if (!response.ok) {
      throw new Error(`Failed to download from Dropbox: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // Extract filename from URL or use provided title
    const urlParts = new URL(dropboxUrl);
    const pathParts = urlParts.pathname.split('/');
    const originalFileName = pathParts[pathParts.length - 1] || 'image.jpg';
    const fileName = title ? `${title}.${getFileExtension(originalFileName)}` : originalFileName;

    // Create temp file
    const tempFilePath = join(tmpdir(), fileName);
    await writeFile(tempFilePath, fileBuffer);

    try {
      console.log('Uploading to Flickr:', fileName);
      
      // Upload to Flickr
      const photoTitle = title || parse(fileName).name;
      const photoId = await upload(tempFilePath, {
        title: photoTitle,
        description: description || '',
        tags: tags || '',
        is_public: 1,
        is_friend: 0,
        is_family: 0
      });

      console.log('Photo uploaded with ID:', photoId);

      // Find or create album and add photo
      const albumId = await findOrCreateAlbum(albumTitle, photoId);
      
      // Add photo to album (only if album already existed)
      if (albumId) {
        try {
          await flickr('flickr.photosets.addPhoto', {
            photoset_id: albumId,
            photo_id: photoId,
          });
          console.log('Photo added to existing album:', albumTitle);
        } catch (addPhotoError) {
          // If adding to album fails, it might be because the photo is already the primary photo
          console.log('Note: Could not add photo to album (may already be primary):', addPhotoError.message);
        }
      }

      res.status(200).json({
        success: true,
        fileName: fileName,
        flickrPhotoId: photoId,
        flickrAlbumId: albumId,
        albumTitle: albumTitle,
        flickrUrl: `https://www.flickr.com/photos/${userId}/${photoId}`,
        message: albumId ? 'Photo uploaded and added to album' : 'Photo uploaded and new album created'
      });

    } finally {
      // Clean up temp file
      try {
        await unlink(tempFilePath);
      } catch (unlinkError) {
        console.warn('Failed to delete temp file:', unlinkError.message);
      }
    }

  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ 
      error: 'Transfer failed', 
      details: error.message 
    });
  }
}

// Helper function to get all existing albums
async function getAlbums() {
  try {
    const res = await flickr('flickr.photosets.getList', { 
      user_id: userId 
    });
    
    if (!res.photosets || !res.photosets.photoset) {
      console.log('No existing albums found');
      return [];
    }
    
    const albums = res.photosets.photoset.map((set) => ({
      id: set.id,
      title: set.title._content,
    }));
    
    console.log('Found existing albums:', albums.map(a => a.title));
    return albums;
  } catch (error) {
    console.error('Error getting albums:', error);
    return [];
  }
}

// Helper function to find existing album or create new one
async function findOrCreateAlbum(albumTitle, primaryPhotoId) {
  try {
    console.log('Looking for album:', albumTitle);
    
    const albums = await getAlbums();
    const existingAlbum = albums.find((a) => a.title.toLowerCase() === albumTitle.toLowerCase());

    if (existingAlbum) {
      console.log('Found existing album:', albumTitle, 'with ID:', existingAlbum.id);
      return existingAlbum.id;
    }

    console.log('Creating new album:', albumTitle);
    const res = await flickr('flickr.photosets.create', {
      title: albumTitle,
      primary_photo_id: primaryPhotoId,
      description: `Album: ${albumTitle}`
    });

    console.log('Created new album with ID:', res.photoset.id);
    return res.photoset.id;
  } catch (error) {
    console.error('Error with album operations:', error);
    throw new Error(`Album operation failed: ${error.message}`);
  }
}

// Helper function to get file extension
function getFileExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : 'jpg';
}

// Batch upload endpoint for multiple files
export async function batchUpload(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { files, albumTitle } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }

    if (!albumTitle) {
      return res.status(400).json({ error: 'albumTitle is required' });
    }

    console.log(`Processing batch upload of ${files.length} files to album: ${albumTitle}`);

    const results = [];
    let albumId = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`Processing file ${i + 1}/${files.length}: ${file.dropboxUrl}`);

      try {
        // Download file
        const response = await fetch(file.dropboxUrl);
        if (!response.ok) {
          throw new Error(`Failed to download: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);

        // Extract filename
        const urlParts = new URL(file.dropboxUrl);
        const pathParts = urlParts.pathname.split('/');
        const originalFileName = pathParts[pathParts.length - 1] || `image_${i}.jpg`;
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
            is_public: 1,
            is_friend: 0,
            is_family: 0
          });

          // Handle album (create with first photo, then add subsequent photos)
          if (i === 0) {
            albumId = await findOrCreateAlbum(albumTitle, photoId);
          } else if (albumId) {
            await flickr('flickr.photosets.addPhoto', {
              photoset_id: albumId,
              photo_id: photoId,
            });
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
          fileName: file.dropboxUrl,
          error: fileError.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    res.status(200).json({
      success: true,
      albumTitle: albumTitle,
      albumId: albumId,
      totalFiles: files.length,
      successCount: successCount,
      failCount: failCount,
      results: results,
      message: `Batch upload completed: ${successCount} successful, ${failCount} failed`
    });

  } catch (error) {
    console.error('Batch upload error:', error);
    res.status(500).json({ 
      error: 'Batch upload failed', 
      details: error.message 
    });
  }
}
