import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

type Location = {
  lat: number;
  lng: number;
};

type LiteracyCenter = {
  id: string;
  name: string;
  address: string;
  rating?: number;
  userRatingsTotal?: number;
  location?: Location;
};

const FAVORITES_STORAGE_KEY = `literacy_map_favorites`;
const STREAK_STORAGE_KEY = `literacy_map_streak`;

const defaultCenter: Location = { lat: 38.9072, lng: -77.0369 };

const getStreakLabel = (streakDays: number) => {
  if (streakDays <= 1) return `1 day`;
  return `${streakDays} days`;
};

const normalizeDate = (date: Date) => date.toISOString().split(`T`)[0];

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const distanceInMiles = (from: Location, to: Location) => {
  const earthRadiusMiles = 3958.8;
  const latDiff = toRadians(to.lat - from.lat);
  const lngDiff = toRadians(to.lng - from.lng);
  const a =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(lngDiff / 2) * Math.sin(lngDiff / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
};

const LiteracyMap = () => {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [centers, setCenters] = useState<LiteracyCenter[]>([]);
  const [userLocation, setUserLocation] = useState<Location | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  });
  const [streakDays, setStreakDays] = useState(1);

  const apiKey = import.meta.env.STATIC_SITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    const stored = localStorage.getItem(STREAK_STORAGE_KEY);
    const today = normalizeDate(new Date());
    const yesterday = normalizeDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

    if (!stored) {
      localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify({ day: today, streak: 1 }));
      setStreakDays(1);
      return;
    }

    const parsed = JSON.parse(stored) as { day: string; streak: number };

    if (parsed.day === today) {
      setStreakDays(parsed.streak);
      return;
    }

    const nextStreak = parsed.day === yesterday ? parsed.streak + 1 : 1;
    localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify({ day: today, streak: nextStreak }));
    setStreakDays(nextStreak);
  }, []);

  useEffect(() => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (!apiKey) {
      setError(`Google Maps is not configured. Add STATIC_SITE_GOOGLE_MAPS_API_KEY to enable this feature.`);
      setLoading(false);
      return;
    }

    let map: any;
    let userMarker: any;
    let active = true;
    let watchId: number | undefined;
    const markers: any[] = [];

    const loadScript = () => {
      return new Promise<void>((resolve, reject) => {
        if (window.google?.maps) {
          resolve();
          return;
        }

        const existing = document.querySelector<HTMLScriptElement>(`script[data-google-maps='true']`);
        if (existing) {
          existing.addEventListener(`load`, () => resolve(), { once: true });
          existing.addEventListener(`error`, () => reject(new Error(`Unable to load Google Maps script.`)), { once: true });
          return;
        }

        const script = document.createElement(`script`);
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.dataset.googleMaps = `true`;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Unable to load Google Maps script.`));
        document.head.appendChild(script);
      });
    };

    const updateUserMarker = (coords: Location) => {
      if (!window.google?.maps || !map) return;
      if (!userMarker) {
        userMarker = new window.google.maps.Marker({
          map,
          position: coords,
          title: `You are here`,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: `#005ea2`,
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: `#fff`,
          },
        });
        return;
      }

      userMarker.setPosition(coords);
    };

    const findLiteracyCenters = (position: Location) => {
      if (!map || !window.google?.maps?.places || !active) return;
      const service = new window.google.maps.places.PlacesService(map);

      service.nearbySearch(
        {
          location: position,
          rankBy: window.google.maps.places.RankBy.DISTANCE,
          keyword: `literacy center empowerment center adult education tutoring library`,
        },
        (results: any[] | null, status: string) => {
          if (!active) return;

          if (status !== window.google.maps.places.PlacesServiceStatus.OK || !results?.length) {
            setError(`No literacy-focused places were found nearby. Try a denser area or city center.`);
            setCenters([]);
            setLoading(false);
            return;
          }

          markers.forEach((marker) => marker.setMap(null));
          markers.length = 0;

          const topResults = results.slice(0, 8).map((result) => ({
            id: result.place_id,
            name: result.name,
            address: result.vicinity ?? `Address unavailable`,
            rating: result.rating,
            userRatingsTotal: result.user_ratings_total,
            location: result.geometry?.location
              ? {
                  lat: result.geometry.location.lat(),
                  lng: result.geometry.location.lng(),
                }
              : undefined,
          }));

          topResults.forEach((center, index) => {
            if (!center.location) return;
            const marker = new window.google.maps.Marker({
              map,
              position: center.location,
              title: `${index + 1}. ${center.name}`,
              label: `${index + 1}`,
            });
            markers.push(marker);
          });

          setCenters(topResults);
          setError(null);
          setLoading(false);
        }
      );
    };

    const refreshNearbyCenters = (coords: Location) => {
      if (!active || !map) return;
      setUserLocation(coords);
      map.setCenter(coords);
      updateUserMarker(coords);
      findLiteracyCenters(coords);
    };

    const initMap = async () => {
      try {
        await loadScript();
        if (!mapRef.current || !active || !window.google?.maps) return;

        map = new window.google.maps.Map(mapRef.current, {
          center: defaultCenter,
          zoom: 13,
          mapTypeControl: false,
        });

        if (!navigator.geolocation) {
          setUserLocation(defaultCenter);
          updateUserMarker(defaultCenter);
          findLiteracyCenters(defaultCenter);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
            refreshNearbyCenters(coords);
          },
          () => {
            setUserLocation(defaultCenter);
            updateUserMarker(defaultCenter);
            findLiteracyCenters(defaultCenter);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
          }
        );

        watchId = navigator.geolocation.watchPosition(
          (position) => {
            if (!active) return;
            const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
            setUserLocation(coords);
            updateUserMarker(coords);
          },
          () => undefined,
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
        );
      } catch {
        setError(`Google Maps could not be loaded. Please check your API key and referrer settings.`);
        setLoading(false);
      }
    };

    initMap();

    return () => {
      active = false;
      if (watchId !== undefined && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (userMarker) {
        userMarker.setMap(null);
      }
      markers.forEach((marker) => marker.setMap(null));
    };
  }, [apiKey]);

  const closestCenter = useMemo(() => {
    if (!userLocation) return null;

    const candidates = centers
      .filter((center) => !!center.location)
      .map((center) => ({
        center,
        milesAway: distanceInMiles(userLocation, center.location as Location),
      }))
      .sort((first, second) => first.milesAway - second.milesAway);

    return candidates[0] ?? null;
  }, [centers, userLocation]);

  const favoriteCount = favorites.length;
  const challengeMessage = useMemo(() => {
    if (!favoriteCount) return `Save 3 centers to unlock your “Community Reader” challenge.`;
    if (favoriteCount < 3) return `Great start! Save ${3 - favoriteCount} more to complete your challenge.`;
    return `Challenge complete! You’ve built your own local literacy support shortlist.`;
  }, [favoriteCount]);

  const toggleFavorite = (id: string) => {
    setFavorites((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  };

  return (
    <>
      <Helmet>
        <title>Literacy Center Finder</title>
      </Helmet>
      <section>
        <div className='grid-container padding-y-4'>
          <h1 className='margin-top-0'>Literacy Center Finder</h1>
          <p className='font-sans-lg'>
            Discover nearby libraries, tutoring spaces, and empowerment centers powered by Google Maps.
          </p>
          <div className='display-flex flex-align-center flex-wrap gap-2 margin-bottom-2'>
            <span className='usa-tag bg-primary text-white'>Weekly streak: {getStreakLabel(streakDays)}</span>
            <span className='usa-tag bg-accent-cool text-ink'>Favorites saved: {favoriteCount}</span>
          </div>
          <p className='text-bold'>{challengeMessage}</p>
          {closestCenter && (
            <div className='usa-alert usa-alert--info margin-bottom-2'>
              <div className='usa-alert__body'>
                <p className='usa-alert__heading margin-y-0'>Closest empowerment center</p>
                <p className='usa-alert__text margin-top-1'>
                  {closestCenter.center.name} is about {closestCenter.milesAway.toFixed(1)} miles away.
                </p>
              </div>
            </div>
          )}
          <div
            ref={mapRef}
            className='radius-md border border-base-lighter margin-bottom-3'
            style={{ minHeight: `420px`, width: `100%` }}
          />
          {loading && <p>Loading map and literacy centers…</p>}
          {error && (
            <div className='usa-alert usa-alert--warning margin-bottom-3'>
              <div className='usa-alert__body'>
                <p className='usa-alert__text'>{error}</p>
              </div>
            </div>
          )}

          {!!centers.length && (
            <ul className='usa-list usa-list--unstyled'>
              {centers.map((center, index) => {
                const isFavorite = favorites.includes(center.id);
                const directionsUrl = center.location
                  ? `https://www.google.com/maps/dir/?api=1&destination=${center.location.lat},${center.location.lng}`
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(center.name)}`;

                return (
                  <li key={center.id} className='padding-2 margin-bottom-2 border border-base-lighter radius-md'>
                    <h2 className='font-sans-lg margin-y-0'>
                      {index + 1}. {center.name}
                    </h2>
                    <p className='margin-top-1 margin-bottom-05'>{center.address}</p>
                    <p className='margin-y-05'>
                      Rating: {center.rating ?? `N/A`} ({center.userRatingsTotal ?? 0} reviews)
                    </p>
                    <div className='display-flex flex-wrap gap-1 margin-top-1'>
                      <a className='usa-button usa-button--outline margin-0' href={directionsUrl} rel='noreferrer' target='_blank'>
                        Directions
                      </a>
                      <button
                        type='button'
                        className='usa-button margin-0'
                        onClick={() => toggleFavorite(center.id)}
                        aria-pressed={isFavorite}
                      >
                        {isFavorite ? `Saved ★` : `Save ☆`}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <Link className='usa-button usa-button--unstyled' to='/'>
            ← Return to landing page
          </Link>
        </div>
      </section>
    </>
  );
};

export default LiteracyMap;
