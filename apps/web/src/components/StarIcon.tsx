export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" data-icon="favorite-star" viewBox="0 0 24 24">
      <path
        d="m12 3.6 2.55 5.16 5.7.83-4.12 4.02.97 5.67L12 16.6l-5.1 2.68.97-5.67-4.12-4.02 5.7-.83L12 3.6Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}
