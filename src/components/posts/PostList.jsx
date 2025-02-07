import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useFirebase } from '../../contexts/FirebaseContext';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  updateDoc, 
  increment, 
  limit, 
  writeBatch, 
  deleteField,
  serverTimestamp,
  where,  // Added this import
  getDocs, 
  startAfter 
} from 'firebase/firestore';
import { BiSolidLike, BiLike, BiSolidDislike, BiDislike, BiComment } from 'react-icons/bi';

// Add this function inside PostList component
const handleShare = async (post, platform) => {
  const baseUrl = "https://bookclub-khaki.vercel.app";
  const postUrl = `${baseUrl}/post/${post.id}`;
  const text = `Check out this discussion about "${post.bookTitle}" on BookForum`;
  
  switch (platform) {
    case 'twitter':
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(postUrl)}`);
      break;
    case 'facebook':
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}`);
      break;
    case 'copy':
      await navigator.clipboard.writeText(postUrl);
      // You could add a toast notification here
      alert('Link copied to clipboard!');
      break;
  }
};

function PostList() {
  const { user, db, calculateLevel } = useFirebase();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  // Add these state variables at the top with other states
  const [hasMore, setHasMore] = useState(true);
  const [lastPost, setLastPost] = useState(null);

  useEffect(() => {
    const postsQuery = query(
      collection(db, 'posts'),
      orderBy('createdAt', 'desc'),
      limit(5)
    );

    const unsubscribe = onSnapshot(postsQuery, async (snapshot) => {
      const postsData = await Promise.all(snapshot.docs.map(async (doc) => {
        const postData = doc.data();
        console.log('Current post data:', postData.title, 'Comment count:', postData.commentCount);
        
        // Get comments collection for this post
        // In the useEffect and loadMorePosts functions, update the comments query:
        const commentsRef = collection(db, 'posts', doc.id, 'comments');
        const commentsQuery = query(commentsRef);  // Remove the where clause since we're already in the post's subcollection
        const commentsSnap = await getDocs(commentsQuery);
                
        console.log('Actual comments count:', commentsSnap.size, 'for post:', postData.title);
        
        // Update post's commentCount if it doesn't match
        if (commentsSnap.size !== postData.commentCount) {
          console.log('Updating comment count from', postData.commentCount, 'to', commentsSnap.size);
          await updateDoc(doc.ref, {
            commentCount: commentsSnap.size
          });
        }

        return {
          id: doc.id,
          ...postData,
          commentCount: commentsSnap.size,
          createdAt: postData.createdAt
        };
      }));
    
      console.log('Final posts data:', postsData.map(p => ({ title: p.title, comments: p.commentCount })));
      setPosts(postsData);
      setLastPost(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db]);

  const loadMorePosts = async () => {
    if (!hasMore || loading) return;
    
    setLoading(true);
    const nextQuery = query(
      collection(db, 'posts'),
      orderBy('createdAt', 'desc'),
      startAfter(lastPost),
      limit(5)
    );

    try {
      const snapshot = await getDocs(nextQuery);
      const newPosts = await Promise.all(snapshot.docs.map(async (doc) => {
        const postData = doc.data();
        console.log('Loading more - Current post:', postData.title, 'Comment count:', postData.commentCount);
        
        // Get comments for this post
        const commentsRef = collection(db, 'comments');
        const commentsQuery = query(commentsRef, where('postId', '==', doc.id));
        const commentsSnap = await getDocs(commentsQuery);
        
        console.log('Loading more - Actual comments:', commentsSnap.size, 'for post:', postData.title);
        
        if (commentsSnap.size !== postData.commentCount) {
          console.log('Loading more - Updating count from', postData.commentCount, 'to', commentsSnap.size);
          await updateDoc(doc.ref, {
            commentCount: commentsSnap.size
          });
        }

        return {
          id: doc.id,
          ...postData,
          commentCount: commentsSnap.size,
          createdAt: postData.createdAt
        };
      }));
      
      console.log('Loading more - Final data:', newPosts.map(p => ({ title: p.title, comments: p.commentCount })));
      setPosts(prevPosts => [...prevPosts, ...newPosts]);
      setLastPost(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
    } catch (error) {
      console.error('Error loading more posts:', error);
    } finally {
      setLoading(false);
    }
  };

  // Add this at the bottom of your posts list, just before the closing div
  {hasMore && (
    <button 
      onClick={loadMorePosts}
      className="w-full py-4 text-center text-gray-600 hover:text-indigo-600 transition-colors"
      disabled={loading}
    >
      {loading ? 'Loading...' : 'Load More Discussions'}
    </button>
  )}

  const handleVote = async (postId, currentVoters, voteType, post) => {
    if (!user) return;
    
    const postRef = doc(db, 'posts', postId);
    const userVote = currentVoters?.[user.uid];
    
    const batch = writeBatch(db);
    
    // Remove old vote if exists
    if (userVote) {
      // Get the current vote count safely
      const currentVotes = (userVote === 'up' ? post.upVotes : post.downVotes) || 0;
      if (currentVotes > 0) {  // Only decrement if current value is > 0
        batch.update(postRef, {
          [`${userVote}Votes`]: increment(-1),
          interactions: increment(-1),
          [`voters.${user.uid}`]: deleteField()
        });
      }
    }
    
    // Add new vote if different from old vote
    if (!userVote || userVote !== voteType) {
      batch.update(postRef, {
        [`${voteType}Votes`]: increment(1),
        interactions: increment(1),
        [`voters.${user.uid}`]: voteType
      });
    }
    
    try {
      await batch.commit();
    } catch (error) {
      console.error('Error updating vote:', error);
    }
  };

  // Add loading skeleton
  if (loading) {
    return (
      <div className="flex flex-col space-y-6 max-w-5xl mx-auto px-4">
        <div className="animate-pulse space-y-8">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-6 space-y-4">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 bg-gray-200 rounded-full"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                </div>
              </div>
              <div className="h-6 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="h-20 bg-gray-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-8 max-w-5xl mx-auto px-4">
      {/* Header section */}
      <div className="flex justify-between items-center py-8">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold text-gray-900">
            Recent Discussions
          </h1>
          <p className="text-gray-600">Join the conversation about your favorite books</p>
        </div>
        {user && (
          <Link
            to="/create-post"
            className="px-8 py-4 bg-[#6366F1] text-white text-lg font-medium rounded-full
              shadow-lg hover:bg-[#5558E5] transition-all duration-300"
          >
            Create Post
          </Link>
        )}
      </div>
      
      {/* Posts list with optimizations */}
      <div className="flex flex-col space-y-6">
        {posts?.length === 0 && !loading ? (
          <div className="text-center py-20 bg-white rounded-3xl shadow-lg border border-gray-100">
            <h3 className="text-4xl font-bold text-indigo-900 mb-4">
              No discussions yet
            </h3>
            <p className="text-lg text-gray-600 mb-10 max-w-md mx-auto">
              Be the first to start a discussion about your favorite book!
            </p>
            {user ? (
              <Link
                to="/create-post"
                className="inline-flex px-10 py-4 bg-[#6366F1] text-white text-lg font-semibold 
                  rounded-full shadow-xl hover:bg-[#4F46E5] 
                  transition-all duration-300 ease-in-out
                  ring-2 ring-indigo-200"
              >
                Create First Post
              </Link>
            ) : (
              <Link
                to="/signin"
                className="inline-flex px-10 py-4 bg-[#6366F1] text-white text-lg font-semibold 
                  rounded-full shadow-xl hover:bg-[#4F46E5] 
                  transition-all duration-300 ease-in-out
                  ring-2 ring-indigo-200"
              >
                Sign in to Post
              </Link>
            )}
          </div>
        ) : (
          <>
            {posts?.map(post => (
              <div 
                key={post.id}
                className="bg-white rounded-2xl p-6 shadow-md hover:shadow-xl 
                  transition-all duration-300 border border-gray-100/50 will-change-transform"
              >
                {/* Post content with optimized image loading */}
                <div className="flex items-center space-x-4 mb-6">
                  {post.userPhoto ? (
                    <img 
                      src={post.userPhoto} 
                      alt=""
                      loading="lazy"
                      className="w-14 h-14 rounded-full ring-4 ring-indigo-50"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-50 to-white 
                      flex items-center justify-center ring-4 ring-indigo-50">
                      <span className="text-2xl font-medium text-indigo-600">
                        {post.userName?.charAt(0)?.toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-medium text-indigo-600">
                      Level {calculateLevel(post.interactions || 0)}
                    </div>
                  </div>
                </div>

                <Link to={`/post/${post.id}`} className="group block">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4 group-hover:text-indigo-600 
                    transition-colors duration-300">
                    {post.title}
                  </h2>
                  <div className="text-sm font-medium text-indigo-600 mb-4 flex items-center space-x-2">
                    <span>Book:</span>
                    <span className="text-gray-700">{post.bookTitle}</span>
                  </div>
                  <div className="text-sm font-medium text-indigo-600 mb-4 flex items-center space-x-2">
                    <span>Author:</span>
                    <span className="text-gray-700"> {post.bookAuthor}</span>
                  </div>
                  <p className="text-gray-600 leading-relaxed mb-6">{post.content}</p>
                </Link>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pt-6 border-t border-gray-100 gap-4 sm:gap-0">
                  <div className="flex items-center space-x-8">
                    <span className="text-sm text-gray-600">{post.userName}</span>
                    <div className="flex items-center space-x-6">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleVote(post.id, post.voters, 'up', post);
                        }}
                        disabled={!user}
                        className={`flex items-center space-x-1 text-lg hover:scale-110 transition-transform disabled:opacity-50
                          ${post.voters?.[user?.uid] === 'up' ? 'text-indigo-600' : 'text-gray-500'}`}
                        title={user ? "Like" : "Sign in to vote"}
                      >
                        {post.voters?.[user?.uid] === 'up' ? <BiSolidLike /> : <BiLike />}
                        <span className="text-sm">
                          {post.upVotes || 0}
                        </span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleVote(post.id, post.voters, 'down', post);
                        }}
                        disabled={!user}
                        className={`flex items-center space-x-1 text-lg hover:scale-110 transition-transform disabled:opacity-50
                          ${post.voters?.[user?.uid] === 'down' ? 'text-indigo-600' : 'text-gray-500'}`}
                        title={user ? "Dislike" : "Sign in to vote"}
                      >
                        {post.voters?.[user?.uid] === 'down' ? <BiSolidDislike /> : <BiDislike />}
                        <span className="text-sm">
                          {post.downVotes || 0}
                        </span>
                      </button>
                      <Link 
                        to={`/post/${post.id}`}
                        className="flex items-center space-x-1 text-gray-500 hover:text-indigo-600 
                          transition-colors hover:scale-110"
                      >
                        <BiComment className="text-lg" />
                        <span className="text-sm">
                          {post.commentCount || 0}
                        </span>
                      </Link>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500">
                    {post.createdAt?.toDate().toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
            
            {hasMore && (
              <button 
                onClick={loadMorePosts}
                className="w-full py-4 mt-4 text-center text-gray-600 hover:text-indigo-600 
                  transition-colors bg-white rounded-xl border border-gray-100 hover:border-indigo-100"
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load More Discussions'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default PostList;